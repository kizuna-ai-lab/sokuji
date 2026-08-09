import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { managedVoiceSource } from './voiceLibrarySource';
import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
import { loadVoiceClip, resetVoiceClipStorageForTesting } from '../../../lib/soniox/voiceClipStorage';
import type { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';

beforeEach(async () => { await resetVoiceClipStorageForTesting(); });

const fakeClient = (over: Partial<ManagedVoicesClient> = {}) => ({
  mine: vi.fn().mockResolvedValue(null),
  ensure: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  ...over,
} as unknown as ManagedVoicesClient);

const clip = () => new Blob([new Uint8Array([7, 7, 7])], { type: 'audio/wav' });

/** jsdom here has no `Blob.prototype.arrayBuffer` — same feature-detect +
 *  FileReader fallback `src/lib/soniox/voiceClipStorage.ts` ships. Calling
 *  `blob.arrayBuffer()` directly in a test throws a TypeError under vitest. */
const readBytes = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

describe('managedVoiceSource.list', () => {
  it('is empty when the account holds no voice', async () => {
    expect(await managedVoiceSource(fakeClient()).list()).toEqual([]);
  });

  it('projects the single voice into the shape the section renders', async () => {
    // The section decides ready/failed by looking for a tts-rt-v1 entry in
    // `models`. Without that projection a perfectly ready managed voice
    // renders as "processing…" forever and can never be selected.
    const client = fakeClient({
      mine: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready', createdAt: 42 }),
    });
    const [voice] = await managedVoiceSource(client).list();
    expect(voice.id).toBe('v1');
    expect(voice.models).toEqual([{ model: 'tts-rt-v1', status: 'ready' }]);
  });
});

describe('managedVoiceSource.create', () => {
  it('stores the clip on this device before asking the backend to build', async () => {
    // The clip is the ONLY copy: the backend never keeps it. Saving after a
    // successful build would lose it whenever the build fails, leaving a user
    // who has to re-record for a retry.
    const client = fakeClient({
      ensure: vi.fn().mockResolvedValue({ voiceId: 'v9', status: 'processing' }),
    });
    const created = await managedVoiceSource(client).create('ignored', clip());
    expect(created.id).toBe('v9');
    const stored = await loadVoiceClip();
    expect(new Uint8Array(await readBytes(stored!))).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('keeps the clip when the build request fails', async () => {
    const client = fakeClient({
      ensure: vi.fn().mockRejectedValue(new SonioxVoicesError('pool_exhausted', 'busy', 409, 3000)),
    });
    await expect(managedVoiceSource(client).create('x', clip())).rejects.toMatchObject({
      errorType: 'pool_exhausted',
    });
    expect(await loadVoiceClip()).not.toBeNull();
  });

  it('does not pin — building a voice is not starting a session', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v9', status: 'processing' });
    await managedVoiceSource(fakeClient({ ensure })).create('x', clip());
    expect(ensure).toHaveBeenCalledWith({ pin: false, clip: expect.any(Blob) });
  });
});

describe('managedVoiceSource.delete', () => {
  it('forgets the local clip too — a delete that leaves the recording is not a delete', async () => {
    const client = fakeClient();
    const source = managedVoiceSource(client);
    await source.create('x', clip()).catch(() => {});
    await source.delete('v1');
    expect(client.remove).toHaveBeenCalled();
    expect(await loadVoiceClip()).toBeNull();
  });

  it('keeps the clip when the backend refuses the delete', async () => {
    // A voice_pinned refusal means nothing was deleted anywhere. Dropping the
    // clip here would punish the user for a failed request.
    const client = fakeClient({
      remove: vi.fn().mockRejectedValue(new SonioxVoicesError('voice_pinned', 'pinned', 409)),
      ensure: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing' }),
    });
    const source = managedVoiceSource(client);
    await source.create('x', clip());
    await expect(source.delete('v1')).rejects.toMatchObject({ errorType: 'voice_pinned' });
    expect(await loadVoiceClip()).not.toBeNull();
  });
});

describe('managedVoiceSource.waitUntilReady', () => {
  it('resolves once the backend reports ready', async () => {
    const mine = vi.fn()
      .mockResolvedValueOnce({ voiceId: 'v1', status: 'processing', createdAt: 1 })
      .mockResolvedValueOnce({ voiceId: 'v1', status: 'ready', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), { intervalMs: 0 });
    const voice = await source.waitUntilReady('v1');
    expect(voice.models?.[0].status).toBe('ready');
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it('rejects terminally on failed', async () => {
    // Soniox's `failed` is terminal — retrying the same clip can only fail
    // again. The section maps voice_failed to "try a clearer clip".
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'failed', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), { intervalMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'voice_failed' });
  });

  it('rejects when the slot disappears mid-build', async () => {
    // Another device's ensure() can supersede this build, or the LRU can
    // evict the row. Either way there is nothing left to wait for.
    const source = managedVoiceSource(fakeClient({ mine: vi.fn().mockResolvedValue(null) }), { intervalMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'voice_failed' });
  });

  it('gives up after the timeout rather than polling forever', async () => {
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), { intervalMs: 0, timeoutMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'timeout' });
  });
});

describe('managedVoiceSource previewing', () => {
  it('cannot preview — there is no Soniox key to synthesize with', async () => {
    expect(managedVoiceSource(fakeClient()).canPreview).toBe(false);
  });
});
