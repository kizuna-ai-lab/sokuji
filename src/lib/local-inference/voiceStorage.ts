/**
 * voiceStorage — IndexedDB-backed library for user-imported Supertonic voices.
 *
 * Schema (in shared 'sokuji-models' DB, version 2+):
 *   Store 'voice_styles':
 *     keyPath: 'id' (auto-increment number)
 *     value: StoredVoice
 *     index: 'engine' (non-unique)
 *
 * Sids for imported voices are computed at engine init time as
 * `id + IMPORTED_SID_OFFSET (= 10)` — see sidMapping.ts.
 *
 * Validation logic lives in Task 18 (`validateVoiceFile`).
 */

import { getDb } from './modelStorage';

export interface StoredVoice {
  id: number;
  engine: 'supertonic-3';
  name: string;
  jsonData: Blob;
  importedAt: number;
}

type Engine = StoredVoice['engine'];

const STORE = 'voice_styles';

export async function listVoices(engine: Engine): Promise<StoredVoice[]> {
  const conn = await getDb();
  const out = await conn.getAllFromIndex(STORE, 'engine', engine);
  return (out ?? []) as StoredVoice[];
}

export async function getVoice(id: number): Promise<StoredVoice | undefined> {
  const conn = await getDb();
  return (await conn.get(STORE, id)) as StoredVoice | undefined;
}

export async function addVoice(
  engine: Engine, name: string, file: File,
): Promise<StoredVoice> {
  const existing = await listVoices(engine);
  const finalName = uniquifyName(name, existing.map(v => v.name));
  const jsonData = new Blob([await readFileAsArrayBuffer(file)], { type: 'application/json' });
  const record: Omit<StoredVoice, 'id'> = {
    engine,
    name: finalName,
    jsonData,
    importedAt: Date.now(),
  };
  const conn = await getDb();
  const id = (await conn.add(STORE, record)) as number;
  return { id, ...record };
}

export async function renameVoice(id: number, name: string): Promise<void> {
  const conn = await getDb();
  const cur = (await conn.get(STORE, id)) as StoredVoice | undefined;
  if (!cur) throw new Error(`Voice ${id} not found`);
  await conn.put(STORE, { ...cur, name });
}

export async function deleteVoice(id: number): Promise<void> {
  const conn = await getDb();
  await conn.delete(STORE, id);
}

export async function resetVoiceStorageForTesting(): Promise<void> {
  const conn = await getDb();
  await conn.clear(STORE);
}

/**
 * Read a File as an ArrayBuffer, compatible with both browser and jsdom environments.
 * jsdom's File may not implement arrayBuffer(); fall back to FileReader.
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function uniquifyName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
