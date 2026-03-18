/**
 * Model Storage — IndexedDB wrapper for persisting model files as Blobs.
 *
 * Database: 'sokuji-models', version 1
 *   Store 'files':    key = '{modelId}/{filename}' → Blob
 *   Store 'metadata': key = modelId → ModelMetadata
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { ModelStatus } from './modelManifest';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelMetadata {
  modelId: string;
  status: ModelStatus;
  downloadedAt: number | null;
  totalSizeBytes: number;
  version: string;
  /** Which variant was downloaded (e.g. 'q4', 'q4f16'). Undefined for legacy downloads. */
  variant?: string;
}

interface SokujiModelsDB {
  files: {
    key: string;
    value: Blob;
  };
  metadata: {
    key: string;
    value: ModelMetadata;
  };
}

// ─── Database ────────────────────────────────────────────────────────────────

const DB_NAME = 'sokuji-models';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SokujiModelsDB>> | null = null;

function getDb(): Promise<IDBPDatabase<SokujiModelsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SokujiModelsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata');
        }
      },
    });
  }
  return dbPromise;
}

// ─── File Operations ─────────────────────────────────────────────────────────

function fileKey(modelId: string, filename: string): string {
  return `${modelId}/${filename}`;
}

/** Store a single file blob for a model */
export async function storeFile(modelId: string, filename: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('files', blob, fileKey(modelId, filename));
}

/** Retrieve a file blob for a model */
export async function getFile(modelId: string, filename: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('files', fileKey(modelId, filename));
}

/** Check if a specific file exists for a model */
export async function hasFile(modelId: string, filename: string): Promise<boolean> {
  const db = await getDb();
  const blob = await db.get('files', fileKey(modelId, filename));
  return blob !== undefined;
}

/**
 * Check if all listed files exist for a model.
 * @param filenames - List of filenames that should be present
 */
export async function hasAllFiles(modelId: string, filenames: string[]): Promise<boolean> {
  const db = await getDb();
  for (const filename of filenames) {
    const blob = await db.get('files', fileKey(modelId, filename));
    if (!blob) return false;
  }
  return true;
}

/** Delete all files for a model */
export async function deleteModelFiles(modelId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');

  // Iterate all entries and delete those matching the model prefix
  let cursor = await store.openCursor();
  const prefix = `${modelId}/`;
  while (cursor) {
    if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ─── Metadata Operations ─────────────────────────────────────────────────────

/** Get metadata for a model */
export async function getMetadata(modelId: string): Promise<ModelMetadata | undefined> {
  const db = await getDb();
  return db.get('metadata', modelId);
}

/** Set metadata for a model */
export async function setMetadata(modelId: string, metadata: ModelMetadata): Promise<void> {
  const db = await getDb();
  await db.put('metadata', metadata, modelId);
}

/** Get metadata for all models */
export async function getAllMetadata(): Promise<ModelMetadata[]> {
  const db = await getDb();
  return db.getAll('metadata');
}

/** Delete metadata for a model */
export async function deleteMetadata(modelId: string): Promise<void> {
  const db = await getDb();
  await db.delete('metadata', modelId);
}

// ─── Convenience ─────────────────────────────────────────────────────────────

/** Fully remove a model: files + metadata */
export async function deleteModel(modelId: string): Promise<void> {
  await deleteModelFiles(modelId);
  await deleteMetadata(modelId);
}

/** Clear all data from both files and metadata stores */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['files', 'metadata'], 'readwrite');
  await tx.objectStore('files').clear();
  await tx.objectStore('metadata').clear();
  await tx.done;
}

/** Estimate total storage used (sum of all file blob sizes) */
export async function estimateStorageUsedBytes(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction('files', 'readonly');
  const store = tx.objectStore('files');

  let totalBytes = 0;
  let cursor = await store.openCursor();
  while (cursor) {
    if (cursor.value instanceof Blob) {
      totalBytes += cursor.value.size;
    }
    cursor = await cursor.continue();
  }
  return totalBytes;
}
