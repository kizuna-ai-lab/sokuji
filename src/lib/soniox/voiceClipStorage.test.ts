import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveVoiceClip,
  loadVoiceClip,
  clearVoiceClip,
  resetVoiceClipStorageForTesting,
} from './voiceClipStorage';

beforeEach(async () => { await resetVoiceClipStorageForTesting(); });

const ACCOUNT_A = 'user-a';
const ACCOUNT_B = 'user-b';

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
    await saveVoiceClip(ACCOUNT_A, clip([1, 2, 3, 4]));
    const got = await loadVoiceClip(ACCOUNT_A);
    expect(got).not.toBeNull();
    expect(got!.type).toBe('audio/wav');
    expect(new Uint8Array(await readBlobAsArrayBuffer(got!))).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('holds exactly one clip — saving again replaces it', async () => {
    // One account owns one voice, so a second recording is a REPLACEMENT.
    // Accumulating clips would grow unboundedly and leave the rebuild path
    // guessing which one built the voice that exists.
    await saveVoiceClip(ACCOUNT_A, clip([1]));
    await saveVoiceClip(ACCOUNT_A, clip([2, 2]));
    const got = await loadVoiceClip(ACCOUNT_A);
    expect(new Uint8Array(await readBlobAsArrayBuffer(got!))).toEqual(new Uint8Array([2, 2]));
  });

  it('reports no clip before anything is saved, and after a clear', async () => {
    expect(await loadVoiceClip(ACCOUNT_A)).toBeNull();
    await saveVoiceClip(ACCOUNT_A, clip([9]));
    await clearVoiceClip();
    expect(await loadVoiceClip(ACCOUNT_A)).toBeNull();
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
      expect(await loadVoiceClip(ACCOUNT_A)).toBeNull();
    } finally {
      globalThis.indexedDB = original;
      await resetVoiceClipStorageForTesting();
    }
  });

  it('surfaces a clear failure instead of reporting a delete that did not happen', async () => {
    // Symmetric with saveVoiceClip: a swallowed failure here would let the UI
    // announce a voice deleted while the recording it was built from is still
    // on the device — the exact "left behind after an explicit delete"
    // outcome this feature's privacy claim rules out.
    await resetVoiceClipStorageForTesting();
    const original = globalThis.indexedDB;
    // @ts-expect-error deliberately breaking the global for this assertion
    globalThis.indexedDB = { open: () => { throw new Error('denied'); } };
    try {
      await expect(clearVoiceClip()).rejects.toThrow('denied');
    } finally {
      globalThis.indexedDB = original;
      await resetVoiceClipStorageForTesting();
    }
  });
});

describe('voiceClipStorage account scoping', () => {
  // One browser profile / one Electron install is one device, shared by
  // however many people sign in on it. The recording is biometric material
  // and the backend keeps no copy, so this module is the ONLY thing standing
  // between "A recorded a clip here" and "B's session uploaded it under B's
  // account, and B's translated speech came out in A's voice".

  it('does not hand one account\'s recording to another account', async () => {
    await saveVoiceClip(ACCOUNT_A, clip([1, 2, 3]));
    expect(await loadVoiceClip(ACCOUNT_B)).toBeNull();
    // A's own read still works — the record was withheld, not destroyed.
    expect(await loadVoiceClip(ACCOUNT_A)).not.toBeNull();
  });

  it('replaces the stored recording when a second account saves one', async () => {
    // Deliberately ONE slot: keeping every user's recording around would be a
    // worse privacy position than replacing, not a better one.
    await saveVoiceClip(ACCOUNT_A, clip([1, 1]));
    await saveVoiceClip(ACCOUNT_B, clip([2, 2, 2]));
    const forB = await loadVoiceClip(ACCOUNT_B);
    expect(new Uint8Array(await readBlobAsArrayBuffer(forB!))).toEqual(new Uint8Array([2, 2, 2]));
    // A's clip is gone from this device, not merely shadowed.
    expect(await loadVoiceClip(ACCOUNT_A)).toBeNull();
  });

  it('walks the full sign-out / sign-in sequence: B never sees A\'s recording', async () => {
    // 1. A signs in and records.
    await saveVoiceClip(ACCOUNT_A, clip([7, 7, 7]));
    // 2. A signs out. Nothing clears the clip — that is the point: the record
    //    survives so A can rebuild an evicted voice on their next sign-in.
    // 3. B signs in on the same device and presses Start. `ensure` answers
    //    409 clip_required, and the Start path asks this module for a clip.
    expect(await loadVoiceClip(ACCOUNT_B)).toBeNull();
    // 4. B records their own; A's bytes are replaced, not appended.
    await saveVoiceClip(ACCOUNT_B, clip([8]));
    expect(new Uint8Array(await readBlobAsArrayBuffer((await loadVoiceClip(ACCOUNT_B))!)))
      .toEqual(new Uint8Array([8]));
    // 5. A signs back in: their recording is genuinely gone, so a cold slot
    //    prompts a fresh recording rather than resurrecting B's.
    expect(await loadVoiceClip(ACCOUNT_A)).toBeNull();
  });

  it('refuses to store a recording with no owning account', async () => {
    // An ownerless record is readable by every later signed-in user of this
    // device — exactly what the accountId field exists to prevent — so this
    // fails loudly rather than writing one.
    await expect(saveVoiceClip('', clip([1]))).rejects.toThrow(/owning account/);
  });

  it('answers null when nobody is signed in', async () => {
    await saveVoiceClip(ACCOUNT_A, clip([1]));
    expect(await loadVoiceClip(undefined)).toBeNull();
    expect(await loadVoiceClip(null)).toBeNull();
  });
});
