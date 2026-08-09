import { describe, it, expect, vi } from 'vitest';
import { prepareManagedVoice, voicePrepNotice } from './prepareManagedVoice';
import { SonioxVoicesError } from '../../services/clients/SonioxVoicesClient';
import type { ManagedVoicesClient } from '../../services/clients/ManagedVoicesClient';

const clip = () => new Blob([new Uint8Array([1])], { type: 'audio/wav' });

const deps = (over: {
  ensure?: unknown;
  mine?: unknown;
  loadClip?: () => Promise<Blob | null>;
} = {}) => ({
  client: {
    ensure: over.ensure ?? vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready' }),
    mine: over.mine ?? vi.fn(),
    remove: vi.fn(),
  } as unknown as ManagedVoicesClient,
  loadClip: over.loadClip ?? (async () => clip()),
  sleep: async () => {},
  pollIntervalMs: 0,
});

describe('prepareManagedVoice', () => {
  it('takes the warm path without uploading anything', async () => {
    // The whole point of a warm cache entry: no 10 MB upload, no ten-second
    // wait, session starts immediately.
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready' });
    const loadClip = vi.fn();
    const res = await prepareManagedVoice(deps({ ensure, loadClip }));
    expect(res).toEqual({ ok: true, voiceId: 'v1' });
    expect(ensure).toHaveBeenCalledWith({ pin: true, clip: undefined });
    expect(loadClip).not.toHaveBeenCalled();
  });

  it('uploads the local clip only when the backend asks for one', async () => {
    const ensure = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('clip_required', 'need clip', 409))
      .mockResolvedValueOnce({ voiceId: 'v2', status: 'ready' });
    const res = await prepareManagedVoice(deps({ ensure }));
    expect(res).toEqual({ ok: true, voiceId: 'v2' });
    expect(ensure).toHaveBeenNthCalledWith(2, { pin: true, clip: expect.any(Blob) });
  });

  it('gives up gracefully when this device has never recorded a clip', async () => {
    // Warm slots follow the user anywhere they sign in; a COLD slot on a
    // clip-less device cannot be rebuilt, and that is a documented limitation
    // rather than an error to retry.
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('clip_required', 'need clip', 409));
    const res = await prepareManagedVoice(deps({ ensure, loadClip: async () => null }));
    expect(res).toEqual({ ok: false, reason: 'clip_required' });
  });

  it('polls until the build reports ready', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v3', status: 'processing' });
    const mine = vi.fn()
      .mockResolvedValueOnce({ voiceId: 'v3', status: 'processing', createdAt: 1 })
      .mockResolvedValueOnce({ voiceId: 'v3', status: 'ready', createdAt: 1 });
    expect(await prepareManagedVoice(deps({ ensure, mine }))).toEqual({ ok: true, voiceId: 'v3' });
  });

  it('retries a pool_exhausted refusal exactly once, on the server\'s hint', async () => {
    // The backend pokes its reconciler before refusing, so a pin held by a
    // dead session may well be freed by the time the hint elapses. Retrying
    // forever, though, would just hold Start open while nothing improves.
    const ensure = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('pool_exhausted', 'busy', 409, 3000))
      .mockResolvedValueOnce({ voiceId: 'v4', status: 'ready' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await prepareManagedVoice({ ...deps({ ensure }), sleep });
    expect(res).toEqual({ ok: true, voiceId: 'v4' });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('reports pool_exhausted when the retry is refused too', async () => {
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('pool_exhausted', 'busy', 409, 1));
    expect(await prepareManagedVoice(deps({ ensure }))).toEqual({ ok: false, reason: 'pool_exhausted' });
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('reports voice_failed on a terminal build failure', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v5', status: 'processing' });
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v5', status: 'failed', createdAt: 1 });
    expect(await prepareManagedVoice(deps({ ensure, mine }))).toEqual({ ok: false, reason: 'voice_failed' });
  });

  it('reports unavailable rather than throwing into session start', async () => {
    // Whatever goes wrong here, the session itself is still perfectly
    // startable with a built-in voice. Throwing would abort the whole start.
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('network', 'offline', 0));
    expect(await prepareManagedVoice(deps({ ensure }))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('stops polling at the deadline', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v6', status: 'processing' });
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v6', status: 'processing', createdAt: 1 });
    const res = await prepareManagedVoice({ ...deps({ ensure, mine }), timeoutMs: 0 });
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('voicePrepNotice', () => {
  it('gives every failure its own actionable sentence', () => {
    const reasons = ['clip_required', 'pool_exhausted', 'voice_failed', 'unavailable'] as const;
    const notices = reasons.map((r) => voicePrepNotice(r));
    // Distinct copy per reason: "your custom voice didn't work" tells the user
    // nothing they can act on, and three of these four have different fixes.
    expect(new Set(notices.map((n) => n.key)).size).toBe(4);
    for (const n of notices) expect(n.defaultValue.length).toBeGreaterThan(20);
  });
});
