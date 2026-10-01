import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../contract/clock';
import { boundedFetch } from './boundedFetch';

/** A request that settles only when its signal aborts, rejecting with the signal's reason, as a real `fetch` does. */
const hanging = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
  });

/** A virtual clock whose cancel functions are spied: a settled request proves its timer was cancelled, not merely left to fire. */
function spiedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancels: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancels: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: { setTimeout: (fn, ms) => { const spy = vi.fn(inner.setTimeout(fn, ms)); cancels.push(spy); return spy; } },
    advance: inner.advance,
    cancels,
  };
}

const LATE = 'The provider did not answer within 15 s.';

describe('a bounded check request (Stage 2 OpenAI Realtime, choice 2)', () => {
  it("answers what the request answers, hands it a live signal, and cancels its timer", async () => {
    const { clock, cancels } = spiedClock();
    let seen: AbortSignal | undefined;
    await expect(boundedFetch({ clock, ms: 15_000, late: LATE }, async (signal) => { seen = signal; return 42; })).resolves.toBe(42);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
    expect(cancels[0]).toHaveBeenCalled();
  });

  it("rethrows the request's own failure untouched", async () => {
    const offline = new TypeError('Failed to fetch');
    await expect(boundedFetch({ clock: createVirtualClock(0), ms: 15_000, late: LATE }, async () => { throw offline; })).rejects.toBe(offline);
  });

  it('bounds the request: nothing within the bound, it aborts the request and throws the late words', async () => {
    const { clock, advance } = spiedClock();
    let seen: AbortSignal | undefined;
    const answer = boundedFetch({ clock, ms: 15_000, late: LATE }, (signal) => { seen = signal; return hanging(signal); });
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(14_999);
    expect(seen?.aborted).toBe(false);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow(LATE);
    expect(seen?.aborted).toBe(true);
  });

  it("the caller's signal aborts the request with its reason, cancels the timer and leaves no listener", async () => {
    const { clock, cancels } = spiedClock();
    const caller = new AbortController();
    const removed = vi.spyOn(caller.signal, 'removeEventListener');
    const reason = new Error('cancelled');
    const answer = boundedFetch({ clock, ms: 15_000, signal: caller.signal, late: LATE }, hanging);
    caller.abort(reason);
    await expect(answer).rejects.toBe(reason);
    expect(cancels[0]).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('a caller already aborted throws its reason before the request starts', async () => {
    const run = vi.fn();
    const reason = new Error('gone');
    await expect(boundedFetch({ clock: createVirtualClock(0), ms: 15_000, signal: AbortSignal.abort(reason), late: LATE }, run)).rejects.toBe(reason);
    expect(run).not.toHaveBeenCalled();
  });
});
