import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { byokVoiceSource, managedVoiceSource } from './voiceLibrarySource';
import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
import { loadVoiceClip, resetVoiceClipStorageForTesting } from '../../../lib/soniox/voiceClipStorage';
import type { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';
import type { SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';
import { settleReports, resetReportThrottle } from '../../../lib/diagnostics/report';
import useLogStore from '../../../stores/logStore';

beforeEach(async () => {
  await resetVoiceClipStorageForTesting();
  resetReportThrottle();
  useLogStore.getState().clearLogs();
});

const fakeClient = (over: Partial<ManagedVoicesClient> = {}) => ({
  mine: vi.fn().mockResolvedValue(null),
  ensure: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  // Default region matches ManagedVoicesClient's own default, so a test that
  // doesn't care about the cache namespace still sees a realistic value
  // rather than `managed:undefined`.
  region: 'us',
  sessionKey: vi.fn(),
  previewDone: vi.fn().mockResolvedValue(undefined),
  ...over,
} as unknown as ManagedVoicesClient);

// byokVoiceSource.preview never touches the voices-CRUD client (it only uses
// the injected `synthesize`), so this fake only needs to satisfy the type —
// none of its methods are called by the tests below.
const fakeSonioxClient = () => ({
  list: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  waitUntilReady: vi.fn(),
} as unknown as SonioxVoicesClient);

const ACCOUNT = 'user-a';

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
    expect(await managedVoiceSource(fakeClient(), ACCOUNT).list()).toEqual([]);
  });

  it('projects the single voice into the shape the section renders', async () => {
    // The section decides ready/failed by looking for an entry matching the
    // model this build talks to. Without that projection a perfectly ready
    // managed voice renders as "processing…" forever and can never be
    // selected — and projecting the WRONG model id has the same effect, which
    // is why the id is pinned literally here rather than imported.
    const client = fakeClient({
      mine: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready', createdAt: 42 }),
    });
    const [voice] = await managedVoiceSource(client, ACCOUNT).list();
    expect(voice.id).toBe('v1');
    expect(voice.models).toEqual([{ model: 'tts-rt-v2', status: 'ready' }]);
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
    const created = await managedVoiceSource(client, ACCOUNT).create('ignored', clip());
    expect(created.id).toBe('v9');
    const stored = await loadVoiceClip(ACCOUNT);
    expect(new Uint8Array(await readBytes(stored!))).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('keeps the clip when the build request fails', async () => {
    const client = fakeClient({
      ensure: vi.fn().mockRejectedValue(new SonioxVoicesError('pool_exhausted', 'busy', 409, 3000)),
    });
    await expect(managedVoiceSource(client, ACCOUNT).create('x', clip())).rejects.toMatchObject({
      errorType: 'pool_exhausted',
    });
    expect(await loadVoiceClip(ACCOUNT)).not.toBeNull();
  });

  it('does not pin — building a voice is not starting a session', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v9', status: 'processing' });
    await managedVoiceSource(fakeClient({ ensure }), ACCOUNT).create('x', clip());
    expect(ensure).toHaveBeenCalledWith({ pin: false, clip: expect.any(Blob) });
  });

  it('files the clip under the source\'s own account, not under the device', async () => {
    // One device, several people. The recording is biometric material and the
    // backend keeps no copy, so a clip stored here must be unreadable by the
    // next account signed in on the same profile — otherwise their session
    // start would upload it under THEIR account and speak in this user's
    // voice.
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v9', status: 'processing' });
    await managedVoiceSource(fakeClient({ ensure }), ACCOUNT).create('x', clip());
    expect(await loadVoiceClip(ACCOUNT)).not.toBeNull();
    expect(await loadVoiceClip('someone-else')).toBeNull();
  });
});

describe('managedVoiceSource.delete', () => {
  it('forgets the local clip too — a delete that leaves the recording is not a delete', async () => {
    const client = fakeClient();
    const source = managedVoiceSource(client, ACCOUNT);
    await source.create('x', clip()).catch(() => {});
    await source.delete('v1');
    expect(client.remove).toHaveBeenCalled();
    expect(await loadVoiceClip(ACCOUNT)).toBeNull();
  });

  it('keeps the clip when the backend refuses the delete', async () => {
    // A voice_pinned refusal means nothing was deleted anywhere. Dropping the
    // clip here would punish the user for a failed request.
    const client = fakeClient({
      remove: vi.fn().mockRejectedValue(new SonioxVoicesError('voice_pinned', 'pinned', 409)),
      ensure: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing' }),
    });
    const source = managedVoiceSource(client, ACCOUNT);
    await source.create('x', clip());
    await expect(source.delete('v1')).rejects.toMatchObject({ errorType: 'voice_pinned' });
    expect(await loadVoiceClip(ACCOUNT)).not.toBeNull();
  });

  it('reports a failed clip wipe rather than resolving as if the recording were gone', async () => {
    // The backend delete succeeded, so the voice really is gone — but the
    // recording it was built from is still on this device. Resolving here
    // would have the UI announce a deletion that only half happened, which is
    // exactly the outcome the "no biometric material left behind" claim rules
    // out. A slug of its own lets the section say which half failed.
    const client = fakeClient({
      ensure: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing' }),
    });
    const source = managedVoiceSource(client, ACCOUNT);
    await source.create('x', clip());
    const original = globalThis.indexedDB;
    // @ts-expect-error deliberately breaking the global for this assertion
    globalThis.indexedDB = { open: () => { throw new Error('denied'); } };
    try {
      await resetVoiceClipStorageForTesting();
      await expect(source.delete('v1')).rejects.toMatchObject({ errorType: 'clip_clear_failed' });
      expect(client.remove).toHaveBeenCalled();
    } finally {
      globalThis.indexedDB = original;
      await resetVoiceClipStorageForTesting();
    }
  });
});

describe('managedVoiceSource.waitUntilReady', () => {
  it('resolves once the backend reports ready', async () => {
    const mine = vi.fn()
      .mockResolvedValueOnce({ voiceId: 'v1', status: 'processing', createdAt: 1 })
      .mockResolvedValueOnce({ voiceId: 'v1', status: 'ready', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), ACCOUNT, { pollDelayMs: () => 0 });
    const voice = await source.waitUntilReady('v1');
    expect(voice.models?.[0].status).toBe('ready');
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it('rejects terminally on failed', async () => {
    // Soniox's `failed` is terminal — retrying the same clip can only fail
    // again. The section maps voice_failed to "try a clearer clip".
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'failed', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), ACCOUNT, { pollDelayMs: () => 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'voice_failed' });
  });

  it('rejects when the slot disappears mid-build', async () => {
    // Another device's ensure() can supersede this build, or the LRU can
    // evict the row. Either way there is nothing left to wait for.
    const source = managedVoiceSource(fakeClient({ mine: vi.fn().mockResolvedValue(null) }), ACCOUNT, { pollDelayMs: () => 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'voice_failed' });
  });

  it('waits 1.5s before each of the first two polls, then 3s — and never polls before waiting', async () => {
    // Same schedule as session-start preparation: each poll is one Soniox
    // getVoice against the voices API's own requests-per-minute limit. The
    // ORDER matters as much as the delays: `create` has just reported
    // `processing`, so a poll at t=0 would only repeat that answer.
    const events: string[] = [];
    const processing = { voiceId: 'v1', status: 'processing', createdAt: 1 };
    const mine = vi.fn().mockImplementation(async () => {
      events.push('mine');
      return mine.mock.calls.length < 5 ? processing : { voiceId: 'v1', status: 'ready', createdAt: 1 };
    });
    let t = 0;
    const sleep = vi.fn().mockImplementation(async (ms: number) => { events.push(`sleep:${ms}`); t += ms; });
    const source = managedVoiceSource(fakeClient({ mine }), ACCOUNT, { sleep, now: () => t });
    await source.waitUntilReady('v1');
    expect(events).toEqual([
      'sleep:1500', 'mine',
      'sleep:1500', 'mine',
      'sleep:3000', 'mine',
      'sleep:3000', 'mine',
      'sleep:3000', 'mine',
    ]);
  });

  it('clamps the last wait to the remaining budget and starts no poll past the deadline', async () => {
    // Checking the deadline only before the wait let a 3s wait step over it
    // and then start one more `mine` — a request with its own timeout, holding
    // the panel past the budget it had just been told was spent.
    let t = 0;
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing', createdAt: 1 });
    const sleep = vi.fn().mockImplementation(async (ms: number) => { t += ms; });
    const source = managedVoiceSource(fakeClient({ mine }), ACCOUNT, { sleep, now: () => t, timeoutMs: 4_000 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'timeout' });
    // 1.5s + 1.5s consumed 3s of 4s; the third wait is clamped to the 1s left...
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_500, 1_500, 1_000]);
    // ...and no poll started once that was spent.
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout rather than polling forever', async () => {
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), ACCOUNT, { pollDelayMs: () => 0, timeoutMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'timeout' });
  });
});

describe('managedVoiceSource previewing', () => {
  it('can preview — synthesis goes through a per-preview minted key, not a stored one', () => {
    expect(managedVoiceSource(fakeClient(), ACCOUNT).canPreview).toBe(true);
  });

  it('namespaces the preview cache per region, mirroring byokVoiceSource', () => {
    const client = fakeClient({ region: 'eu' });
    expect(managedVoiceSource(client, ACCOUNT).cacheNamespace).toBe('managed:eu');
  });

  it('mints a preview key, synthesizes with ttsApiKey, then reports done', async () => {
    const calls: string[] = [];
    const client = fakeClient({
      sessionKey: vi.fn(async (body: { mode: 'voice_preview' }) => {
        calls.push(`key:${body.mode}`);
        return { ttsApiKey: 'tk', region: 'us' as const };
      }),
      previewDone: vi.fn(async () => { calls.push('done'); }),
    });
    const synthesize = vi.fn(async (a: { apiKey: string }) => {
      calls.push(`synth:${a.apiKey}`);
      return { audio: new Float32Array(1), sampleRate: 24000 };
    });
    const source = managedVoiceSource(client, ACCOUNT, { synthesize: synthesize as any });

    await source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 });

    expect(calls).toEqual(['key:voice_preview', 'synth:tk', 'done']);
  });

  it('reports done even when synthesis throws', async () => {
    // A user cancelling is far more common than a crash, and preview-done is
    // what makes the charge prompt and releases the account's lease. If it
    // only ran on success, the common path would leave the lease to expire.
    const previewDone = vi.fn(async () => {});
    const client = fakeClient({
      sessionKey: vi.fn(async () => ({ ttsApiKey: 'tk', region: 'us' as const })),
      previewDone,
    });
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => { throw new Error('boom'); }) as any,
    });

    await expect(source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 })).rejects.toThrow('boom');
    expect(previewDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed preview-done as a warning rather than discarding it, without masking the real result', async () => {
    // A systemic preview-done failure (route typo, deploy skew, a token the
    // mint accepts but this route doesn't) must not be invisible: every
    // preview would keep playing, nothing would ever be billed, and the
    // account's next Start would 409 for up to the ~45s backstop with
    // nothing anywhere naming the cause. "Never rethrow" and "discard" are
    // different decisions — this pins that the failure is reported, not just
    // swallowed, while the synthesis result (success here) is untouched.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = fakeClient({
        sessionKey: vi.fn(async () => ({ ttsApiKey: 'tk', region: 'us' as const })),
        previewDone: vi.fn().mockRejectedValue(new Error('502 from /soniox/preview-done')),
      });
      const source = managedVoiceSource(client, ACCOUNT, {
        synthesize: (async () => ({ audio: new Float32Array(1), sampleRate: 24000 })) as any,
      });

      await expect(
        source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 })
      ).resolves.toEqual({ audio: new Float32Array(1), sampleRate: 24000 });

      await settleReports();
      const warnings = useLogStore.getState().allLogs.filter((l) => l.type === 'warning');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toMatch(/preview completion was not reported/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('reports done even when the caller aborts', async () => {
    const previewDone = vi.fn(async () => {});
    const ac = new AbortController();
    const client = fakeClient({
      sessionKey: vi.fn(async () => ({ ttsApiKey: 'tk', region: 'us' as const })),
      previewDone,
    });
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => {
        ac.abort();
        throw new SonioxVoicesError('aborted', 'aborted', 0);
      }) as any,
    });

    await expect(
      source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1.0, signal: ac.signal })
    ).rejects.toBeTruthy();
    expect(previewDone).toHaveBeenCalledTimes(1);
  });

  it('does not report done when the key was never minted', async () => {
    // Nothing was leased, so there is nothing to complete; a stray call
    // would 404 and, worse, could complete a DIFFERENT preview lease of this
    // account.
    const previewDone = vi.fn(async () => {});
    const client = fakeClient({
      sessionKey: vi.fn(async () => { throw new Error('402'); }),
      previewDone,
    });
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => { throw new Error('unreachable'); }) as any,
    });

    await expect(source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 })).rejects.toBeTruthy();
    expect(previewDone).not.toHaveBeenCalled();
  });

  it('serializes previews: the next mint waits for the superseded preview to report done', async () => {
    // The section aborts voice A and starts voice B without awaiting A, so
    // B's session-key would race A's preview-done (sent from A's finally).
    // If B's mint lands first the account's lease row is still undone and
    // the backend 409s once. Waiting for A to settle -- outcome ignored --
    // costs one round trip and removes the RACE 409; the GAP 409 (a mint
    // inside the backend's PREVIEW_MIN_GAP_MS of the previous mint) is
    // absorbed by mintPreviewKey's single retry, pinned by 'retries a 409
    // mint once' below.
    const calls: string[] = [];
    let releaseA!: () => void;
    const aHeld = new Promise<void>((resolve) => { releaseA = resolve; });
    const client = fakeClient({
      sessionKey: vi.fn(async () => { calls.push('key'); return { ttsApiKey: 'tk', region: 'us' as const }; }),
      previewDone: vi.fn(async () => { calls.push('done'); }),
    });
    let synthCalls = 0;
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => {
        synthCalls += 1;
        if (synthCalls === 1) { await aHeld; throw new SonioxVoicesError('aborted', 'Preview cancelled', 0); }
        return { audio: new Float32Array(1), sampleRate: 24000 };
      }) as any,
    });

    const ac = new AbortController();
    const a = source.preview!({ id: 'a', language: 'ja', text: 'x', speed: 1, signal: ac.signal });
    const b = source.preview!({ id: 'b', language: 'ja', text: 'x', speed: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['key']); // B has NOT minted while A is in flight

    ac.abort();
    releaseA();
    await expect(a).rejects.toBeTruthy();
    await expect(b).resolves.toEqual({ audio: new Float32Array(1), sampleRate: 24000 });
    expect(calls).toEqual(['key', 'done', 'key', 'done']);
  });

  it('never mints a preview that was cancelled while waiting its turn', async () => {
    let releaseA!: () => void;
    const aHeld = new Promise<void>((resolve) => { releaseA = resolve; });
    const sessionKey = vi.fn(async () => ({ ttsApiKey: 'tk', region: 'us' as const }));
    const previewDone = vi.fn(async () => {});
    const client = fakeClient({ sessionKey, previewDone });
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => { await aHeld; return { audio: new Float32Array(1), sampleRate: 24000 }; }) as any,
    });

    const a = source.preview!({ id: 'a', language: 'ja', text: 'x', speed: 1 });
    const bc = new AbortController();
    const b = source.preview!({ id: 'b', language: 'ja', text: 'x', speed: 1, signal: bc.signal });
    bc.abort();

    // B rejects AT ONCE — it does not sit through A, which is still held
    // (releaseA() has not been called yet).
    await expect(b).rejects.toMatchObject({ errorType: 'aborted' });
    expect(sessionKey).toHaveBeenCalledTimes(1); // A's only; B never minted
    expect(previewDone).not.toHaveBeenCalled();  // A is still in flight

    releaseA();
    await a;
    expect(previewDone).toHaveBeenCalledTimes(1); // A's only: B leased nothing
  });

  it('keeps a third preview waiting for the ORIGINAL predecessor, even when the one directly ahead of it (B) rejected early', async () => {
    // B queued behind A, then cancelled while merely waiting its turn — B's
    // own run settles (rejects) long before A does. C, queued behind B, must
    // still wait for A: if the chain resolved the instant B's run settled, C
    // would mint (and synthesize) while A is still in flight — exactly the
    // race per-source serialization exists to remove.
    const calls: string[] = [];
    let releaseA!: () => void;
    const aHeld = new Promise<void>((resolve) => { releaseA = resolve; });
    const sessionKey = vi.fn(async () => { calls.push('key'); return { ttsApiKey: 'tk', region: 'us' as const }; });
    const previewDone = vi.fn(async () => { calls.push('done'); });
    const client = fakeClient({ sessionKey, previewDone });
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => { await aHeld; return { audio: new Float32Array(1), sampleRate: 24000 }; }) as any,
    });

    const a = source.preview!({ id: 'a', language: 'ja', text: 'x', speed: 1 });
    const bc = new AbortController();
    const b = source.preview!({ id: 'b', language: 'ja', text: 'x', speed: 1, signal: bc.signal });
    bc.abort();
    await expect(b).rejects.toMatchObject({ errorType: 'aborted' });

    const c = source.preview!({ id: 'c', language: 'ja', text: 'x', speed: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(sessionKey).toHaveBeenCalledTimes(1); // A's only — C has NOT minted while A is in flight

    releaseA();
    await expect(c).resolves.toEqual({ audio: new Float32Array(1), sampleRate: 24000 });
    await a;
    expect(calls).toEqual(['key', 'done', 'key', 'done']); // B contributed nothing
  });

  it('retries a 409 mint once after the backend hint, then surfaces a second 409', async () => {
    // A preview mint had no retry at all (only Start retries, in
    // ManagedSonioxSession.acquire), so a mint inside the backend's
    // PREVIEW_MIN_GAP_MS of the previous preview's mint -- hear the first
    // syllable, skip to the next voice -- was painted as "A session is
    // running". One retry after the hint absorbs the gap; a second 409 is
    // genuinely a live session or a dead preview's 45 s backstop.
    const waits: number[] = [];
    const sessionKey = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('active_lease', 'HTTP 409', 409, 1500))
      .mockResolvedValueOnce({ ttsApiKey: 'tk', region: 'us' as const });
    const previewDone = vi.fn(async () => {});
    const client = fakeClient({ sessionKey, previewDone });
    const source = managedVoiceSource(client, ACCOUNT, {
      sleep: async (ms: number) => { waits.push(ms); },
      synthesize: (async () => ({ audio: new Float32Array(1), sampleRate: 24000 })) as any,
    });

    await expect(source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1 }))
      .resolves.toEqual({ audio: new Float32Array(1), sampleRate: 24000 });
    expect(waits).toEqual([1500]);
    expect(sessionKey).toHaveBeenCalledTimes(2);
    expect(previewDone).toHaveBeenCalledTimes(1);

    sessionKey.mockReset();
    sessionKey.mockRejectedValue(new SonioxVoicesError('active_lease', 'HTTP 409', 409, 3000));
    await expect(source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1 }))
      .rejects.toMatchObject({ status: 409 });
    expect(sessionKey).toHaveBeenCalledTimes(2);  // one retry, then give up
    expect(previewDone).toHaveBeenCalledTimes(1); // unchanged: nothing was leased
  });

  it('retries only a 409: a 402 mint surfaces at once, with no wait and no second mint', async () => {
    const waits: number[] = [];
    const sessionKey = vi.fn().mockRejectedValue(new SonioxVoicesError('insufficient_balance', 'HTTP 402', 402));
    const previewDone = vi.fn(async () => {});
    const client = fakeClient({ sessionKey, previewDone });
    const source = managedVoiceSource(client, ACCOUNT, {
      sleep: async (ms: number) => { waits.push(ms); },
      synthesize: (async () => { throw new Error('unreachable'); }) as any,
    });
    await expect(source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1 })).rejects.toMatchObject({ status: 402 });
    expect(sessionKey).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    expect(previewDone).not.toHaveBeenCalled();
  });

  it('rejects as aborted, without a second mint, when cancelled during the 409 wait', async () => {
    let releaseWait!: () => void;
    const sessionKey = vi.fn().mockRejectedValue(new SonioxVoicesError('active_lease', 'HTTP 409', 409, 3000));
    const previewDone = vi.fn(async () => {});
    const client = fakeClient({ sessionKey, previewDone });
    const source = managedVoiceSource(client, ACCOUNT, {
      sleep: () => new Promise<void>((resolve) => { releaseWait = resolve; }),
      synthesize: (async () => ({ audio: new Float32Array(1), sampleRate: 24000 })) as any,
    });

    const ac = new AbortController();
    const p = source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0)); // the first mint has failed; the wait is in progress
    ac.abort();

    await expect(p).rejects.toMatchObject({ errorType: 'aborted' });
    expect(sessionKey).toHaveBeenCalledTimes(1);
    expect(previewDone).not.toHaveBeenCalled();
    releaseWait();
  });

  it('does not touch the voice slot — a preview is read-only', async () => {
    // Product ruling: auditioning must not pin, touch, or LRU-reorder the
    // account's single managed voice slot. `preview` has no reason to call
    // `ensure`/`mine`/`remove` at all; this pins that it never does.
    const ensure = vi.fn();
    const mine = vi.fn();
    const remove = vi.fn();
    const client = fakeClient({
      ensure, mine, remove,
      sessionKey: vi.fn(async () => ({ ttsApiKey: 'tk', region: 'us' as const })),
      previewDone: vi.fn(async () => {}),
    });
    const source = managedVoiceSource(client, ACCOUNT, {
      synthesize: (async () => ({ audio: new Float32Array(1), sampleRate: 24000 })) as any,
    });

    await source.preview!({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 });

    expect(ensure).not.toHaveBeenCalled();
    expect(mine).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('byokVoiceSource.preview', () => {
  it('synthesizes through the injected client', async () => {
    const synth = vi.fn(async () => ({ audio: new Float32Array([0.5]), sampleRate: 24000 }));
    const src = byokVoiceSource(fakeSonioxClient(), { synthesize: synth, apiKey: 'k', region: 'us' });
    const out = await src.preview!({ id: 'v1', language: 'ja', text: 'こんにちは', speed: 1.0 });
    expect(synth).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'k', region: 'us', voice: 'v1', language: 'ja', text: 'こんにちは', speed: 1.0,
    }));
    expect(out.sampleRate).toBe(24000);
  });

  it('reports canPreview true and namespaces the cache per region', () => {
    const src = byokVoiceSource(fakeSonioxClient(), { apiKey: 'k', region: 'eu' });
    expect(src.canPreview).toBe(true);
    expect(src.cacheNamespace).toBe('soniox:eu');
  });
});
