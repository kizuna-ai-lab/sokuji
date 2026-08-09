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

/**
 * Read a Blob as an ArrayBuffer, compatible with both browser and jsdom environments.
 * jsdom's Blob may not implement arrayBuffer(); fall back to FileReader.
 */
async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
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

describe('voiceClipStorage', () => {
  it('round-trips a clip with its bytes and MIME type intact', async () => {
    await saveVoiceClip(clip([1, 2, 3, 4]));
    const got = await loadVoiceClip();
    expect(got).not.toBeNull();
    expect(got!.type).toBe('audio/wav');
    expect(new Uint8Array(await readBlobAsArrayBuffer(got!))).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('holds exactly one clip — saving again replaces it', async () => {
    // One account owns one voice, so a second recording is a REPLACEMENT.
    // Accumulating clips would grow unboundedly and leave the rebuild path
    // guessing which one built the voice that exists.
    await saveVoiceClip(clip([1]));
    await saveVoiceClip(clip([2, 2]));
    const got = await loadVoiceClip();
    expect(new Uint8Array(await readBlobAsArrayBuffer(got!))).toEqual(new Uint8Array([2, 2]));
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
