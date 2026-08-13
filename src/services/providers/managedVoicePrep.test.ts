import { describe, it, expect, vi } from 'vitest';
import { prepareManagedVoice, voicePrepNotice } from './managedVoicePrep';
import { SonioxVoicesError } from '../clients/SonioxVoicesClient';
import type { ManagedVoicesClient } from '../clients/ManagedVoicesClient';

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
    expect(ensure).toHaveBeenCalledWith({ pin: true, clip: undefined, budgetMs: expect.any(Number) });
    expect(loadClip).not.toHaveBeenCalled();
  });

  it('uploads the local clip only when the backend asks for one', async () => {
    const ensure = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('clip_required', 'need clip', 409))
      .mockResolvedValueOnce({ voiceId: 'v2', status: 'ready' });
    const res = await prepareManagedVoice(deps({ ensure }));
    expect(res).toEqual({ ok: true, voiceId: 'v2' });
    expect(ensure).toHaveBeenNthCalledWith(2, { pin: true, clip: expect.any(Blob), budgetMs: expect.any(Number) });
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

  it('does not start a clip upload once the deadline has already passed', async () => {
    // A warm attempt that itself ate the whole budget must not be followed
    // by an up-to-120s upload against a ceiling that's already gone. With a
    // frozen clock and timeoutMs: 0, the deadline is already behind us by
    // the time the clip_required refusal comes back.
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('clip_required', 'need clip', 409));
    const loadClip = vi.fn().mockResolvedValue(clip());
    const res = await prepareManagedVoice({
      ...deps({ ensure, loadClip }),
      timeoutMs: 0,
      now: () => 1_000,
    });
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    expect(ensure).toHaveBeenCalledTimes(1);
    // Never even reads the clip: there's no time left to send it.
    expect(loadClip).not.toHaveBeenCalled();
  });

  it('does not start a pool_exhausted retry once the deadline has already passed', async () => {
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('pool_exhausted', 'busy', 409, 3_000));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await prepareManagedVoice({
      ...deps({ ensure }),
      sleep,
      timeoutMs: 0,
      now: () => 1_000,
    });
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    expect(ensure).toHaveBeenCalledTimes(1);
    // No point sleeping out a hint when there's no budget left to wait it out.
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not poll again when the wait would step over the deadline', async () => {
    // The deadline used to be checked only BEFORE the sleep, so an interval
    // that crossed it still started one more /mine — and that request carries
    // its own 15s timeout, holding Start disabled well past the budget it had
    // just been told was spent. A moving clock is essential here: with a
    // frozen one the sleep can never consume the remaining time.
    let t = 0;
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v8', status: 'processing' });
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v8', status: 'processing', createdAt: 1 });
    const sleep = vi.fn().mockImplementation(async (ms: number) => { t += ms; });
    const res = await prepareManagedVoice({
      ...deps({ ensure, mine }),
      sleep,
      now: () => t,
      timeoutMs: 1_000,
      pollIntervalMs: 1_500,
    });
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    // Clamped to what was left rather than sleeping the full interval...
    expect(sleep).toHaveBeenCalledWith(1_000);
    // ...and no poll started once that was spent.
    expect(mine).not.toHaveBeenCalled();
  });

  it('gives the poll its remaining budget, so the last one cannot outlive the ceiling', async () => {
    // `mine` carries a fixed 15s request timeout of its own. Letting a poll
    // start just inside the deadline is fine; letting it RUN 15s past is what
    // makes the ceiling soft.
    let t = 0;
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'vA', status: 'processing' });
    const mine = vi.fn().mockResolvedValue({ voiceId: 'vA', status: 'ready', createdAt: 1 });
    const sleep = vi.fn().mockImplementation(async (ms: number) => { t += ms; });
    const res = await prepareManagedVoice({
      ...deps({ ensure, mine }),
      sleep,
      now: () => t,
      timeoutMs: 5_000,
      pollIntervalMs: 1_500,
    });
    expect(res).toEqual({ ok: true, voiceId: 'vA' });
    expect(mine).toHaveBeenCalledWith(3_500);
  });

  it('abandons the clip upload when reading the clip itself ran out the clock', async () => {
    // loadClip pulls up to 10MB out of IndexedDB. Checking the deadline only
    // BEFORE that read let a slow read be followed by the most expensive call
    // in the routine, already over budget.
    let t = 0;
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('clip_required', 'need clip', 409));
    const loadClip = vi.fn().mockImplementation(async () => { t += 10_000; return clip(); });
    const res = await prepareManagedVoice({
      ...deps({ ensure, loadClip }),
      now: () => t,
      timeoutMs: 5_000,
    });
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadClip).toHaveBeenCalledTimes(1);
    // The warm attempt only — no upload was ever started.
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('gives ensure only the budget that is left, so an upload cannot outlive it', async () => {
    // ManagedVoicesClient defaults a clip upload to 120s. Preparation budgets
    // 60s for everything. Without handing the remaining budget down, one cold
    // upload blows through the ceiling with Start disabled and no cancel.
    let t = 0;
    const ensure = vi.fn()
      .mockImplementationOnce(async () => { t += 4_000; throw new SonioxVoicesError('clip_required', 'need clip', 409); })
      .mockResolvedValueOnce({ voiceId: 'v9', status: 'ready' });
    const res = await prepareManagedVoice({
      ...deps({ ensure }),
      now: () => t,
      timeoutMs: 10_000,
    });
    expect(res).toEqual({ ok: true, voiceId: 'v9' });
    expect(ensure).toHaveBeenNthCalledWith(2, {
      pin: true,
      clip: expect.any(Blob),
      budgetMs: 6_000,
    });
  });

  it('clamps a pool_exhausted retry hint to the time actually remaining, not honored verbatim', async () => {
    // The backend's hint is a suggestion, not a budget override — a
    // reconciler bug (or just a generous hint) must not be allowed to hang
    // Start for longer than this routine's own ceiling permits.
    const ensure = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('pool_exhausted', 'busy', 409, 10_000))
      .mockResolvedValueOnce({ voiceId: 'v7', status: 'ready' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await prepareManagedVoice({
      ...deps({ ensure }),
      sleep,
      now: () => 0,
      timeoutMs: 5_000,
    });
    expect(res).toEqual({ ok: true, voiceId: 'v7' });
    // 5000 remaining < the server's 10000ms hint — clamped, not honored.
    expect(sleep).toHaveBeenCalledWith(5_000);
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
