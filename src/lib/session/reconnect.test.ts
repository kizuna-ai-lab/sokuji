import { describe, it, expect } from 'vitest';
import { trackedClock } from '../contract/testing/trackedClock';
import { flush } from '../contract/testing/drive';
import {
  createReconnector, closeCodeAction, MAX_RECONNECTS,
  type AttemptResult, type DropInfo, type GiveUp, type ReconnectedInfo,
} from './reconnect';

const DROP: DropInfo = { cause: 'close', closeCode: 1006, retryable: true, managed: true };
const fail = (code?: string, message = 'nope', reissueMs = 0, reissued = false): AttemptResult =>
  ({ ok: false, final: false, code, message, reissued, reissueMs });
const ok = (reissued = false, reissueMs = 0): AttemptResult => ({ ok: true, reissued, reissueMs });

const micro = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

/** A reconnector on a virtual clock whose attempts answer from a queue the test fills. `hold` makes an attempt wait for the test (or its abort). */
function rig(opts: { hold?: boolean } = {}) {
  const { clock, timers } = trackedClock();
  const answers: AttemptResult[] = [];
  const startedAt: number[] = [];
  const reconnecting: Array<{ attempt: number; drop?: DropInfo }> = [];
  const reconnected: ReconnectedInfo[] = [];
  const gaveUp: GiveUp[] = [];
  const frames: Array<[string, Record<string, unknown>]> = [];
  const signals: AbortSignal[] = [];
  const r = createReconnector({
    clock,
    frame: (t, p) => frames.push([t, p]),
    reconnecting: (e) => reconnecting.push(e),
    reconnected: (e) => reconnected.push(e),
    gaveUp: (e) => gaveUp.push(e),
    attempt: ({ signal }) => {
      startedAt.push(clock.now());
      signals.push(signal);
      if (opts.hold) return new Promise<AttemptResult>(() => {});
      return Promise.resolve(answers.shift() ?? fail());
    },
  });
  /** Advance in `step` ms at a time, letting each attempt's promise settle in between (settling takes microtasks only). */
  const run = async (ms: number, step = 1) => {
    await micro();
    for (let left = ms; left > 0; left -= step) { clock.advance(Math.min(step, left)); await micro(); }
  };
  return { clock, timers, answers, startedAt, reconnecting, reconnected, gaveUp, frames, signals, r, run };
}

describe('createReconnector', () => {
  it('attempts run at 0, 250, 750, 1750, 3750, 7750, 11750 … ms after the drop', async () => {
    const t = rig();
    t.r.dropped(DROP);
    await flush();
    await t.run(12000);
    expect(t.startedAt.slice(0, 7)).toEqual([0, 250, 750, 1750, 3750, 7750, 11750]);
    t.r.cancel();
  });

  it('an attempt still running at 30 000 ms is aborted and the reconnector gives up with timeout and code connection_lost', async () => {
    const t = rig({ hold: true });
    t.r.dropped(DROP);
    await t.run(29999);
    expect(t.gaveUp).toEqual([]);
    expect(t.signals[0].aborted).toBe(false);
    await t.run(1);
    expect(t.signals[0].aborted).toBe(true);
    expect(t.gaveUp).toEqual([{ attempts: 1, reason: 'timeout', code: 'connection_lost', message: 'Connection lost', errorCode: undefined }]);
    expect(t.r.active).toBe(false);
    expect(t.timers()).toBe(0);
  });

  it("the last failed attempt's code is GiveUp.errorCode", async () => {
    const t = rig();
    t.answers.push(fail('first', 'one'), fail('server_busy', 'two'));
    t.r.dropped(DROP);
    await t.run(250 + 1);
    // From here on every attempt fails with no code; the default answer.
    t.answers.push(...Array.from({ length: 50 }, () => fail('server_busy', 'again')));
    await t.run(30000);
    expect(t.gaveUp).toHaveLength(1);
    expect(t.gaveUp[0]).toMatchObject({ reason: 'timeout', code: 'connection_lost', errorCode: 'server_busy', message: 'again' });
  });

  it('a final refusal gives up at once with its reason and code', async () => {
    const t = rig();
    t.answers.push(fail('x'), { ok: false, final: true, reason: 'refused', code: 'sign_in_required', message: 'Sign in', refusalCode: 'sign_in_required' });
    t.r.dropped(DROP);
    await t.run(250);
    expect(t.gaveUp).toEqual([{ attempts: 2, reason: 'refused', code: 'sign_in_required', message: 'Sign in', refusalCode: 'sign_in_required', errorCode: 'x' }]);
    expect(t.r.active).toBe(false);
    expect(t.timers()).toBe(0);
    await t.run(60000);
    expect(t.startedAt).toHaveLength(2);
  });

  it('reconnecting carries attempt N on every attempt and drop on the first only', async () => {
    const t = rig();
    t.answers.push(fail(), fail(), ok());
    t.r.dropped(DROP);
    await t.run(750);
    expect(t.reconnecting).toEqual([{ attempt: 1, drop: DROP }, { attempt: 2 }, { attempt: 3 }]);
  });

  it('reconnected carries attempts, budgetShared false, and reissue time summed across attempts', async () => {
    const t = rig();
    t.answers.push(fail('c', 'm', 40, true), fail('c', 'm', 60, false), ok(false, 25));
    t.r.dropped(DROP);
    await t.run(750);
    expect(t.reconnected).toEqual([{ attempts: 3, credentialsReissued: true, reissueMs: 125, budgetShared: false }]);
    expect(t.r.active).toBe(false);
    expect(t.timers()).toBe(0);
  });

  it('a drop 5 s after reconnecting shares the deadline; 11 s after gets a fresh 30 s', async () => {
    const t = rig();
    t.answers.push(ok());
    t.r.dropped(DROP);
    await t.run(1000);
    expect(t.reconnected).toHaveLength(1);
    // Reconnected at 0; the first deadline was 30 000. Drop 5 s later (at 5 000): it ends at 30 000, 25 s, not 35 000.
    await t.run(4000);
    t.answers.push(...Array.from({ length: 80 }, () => fail()));
    t.r.dropped(DROP);
    await t.run(24999);
    expect(t.gaveUp).toEqual([]);
    await t.run(1);
    expect(t.gaveUp).toHaveLength(1);
    expect(t.clock.now()).toBe(30000);

    const u = rig();
    u.answers.push(ok());
    u.r.dropped(DROP);
    await u.run(1000);
    await u.run(10000);
    u.answers.push(...Array.from({ length: 80 }, () => fail()));
    u.r.dropped(DROP);
    const droppedAt = u.clock.now();
    expect(droppedAt).toBe(11000);
    await u.run(29999);
    expect(u.gaveUp).toEqual([]);
    await u.run(1);
    expect(u.gaveUp).toHaveLength(1);
    expect(u.clock.now()).toBe(droppedAt + 30000);
  });

  it('a shared deadline is never less than 5 s away', async () => {
    const t = rig();
    // Attempts 1–10 fail (to 23 750); the 11th, at 27 750, reconnects with 2.25 s of the first budget left.
    t.answers.push(...Array.from({ length: 10 }, () => fail()), ok());
    t.r.dropped(DROP);
    await t.run(27750);
    expect(t.reconnected).toHaveLength(1);
    await t.run(250);
    t.answers.push(...Array.from({ length: 30 }, () => fail()));
    t.r.dropped(DROP);
    const droppedAt = t.clock.now();
    expect(droppedAt).toBe(28000);
    await t.run(4999);
    expect(t.gaveUp).toEqual([]);
    await t.run(1);
    expect(t.clock.now()).toBe(droppedAt + 5000);
    expect(t.gaveUp).toHaveLength(1);
  });

  it('a reconnect inside the flapping window reports budgetShared', async () => {
    const t = rig();
    t.answers.push(ok(), ok());
    t.r.dropped(DROP);
    await t.run(2000);
    t.r.dropped(DROP);
    await t.run(1);
    expect(t.reconnected.map((e) => e.budgetShared)).toEqual([false, true]);
  });

  it('the 101st drop gives up with session_cap without an attempt', async () => {
    const t = rig();
    for (let i = 0; i < MAX_RECONNECTS; i += 1) {
      t.answers.push(ok());
      t.r.dropped(DROP);
      await t.run(11000, 11000);
    }
    expect(t.reconnected).toHaveLength(MAX_RECONNECTS);
    expect(t.gaveUp).toEqual([]);
    const before = t.startedAt.length;
    t.r.dropped(DROP);
    expect(t.startedAt.length).toBe(before);
    expect(t.gaveUp).toEqual([{ attempts: 0, reason: 'session_cap', code: 'connection_lost', message: 'Connection lost' }]);
    expect(t.frames[t.frames.length - 1]).toEqual(['session.connection_lost', { attempts: 0 }]);
    expect(t.timers()).toBe(0);
  });

  it('wake during a wait starts the attempt at once; wake during an attempt skips the next delay', async () => {
    const t = rig();
    t.answers.push(fail(), fail(), fail());
    t.r.dropped(DROP);
    await t.run(250);
    // Attempt 2 failed at 250; attempt 3 waits until 750. Wake at 300.
    await t.run(50);
    expect(t.startedAt).toEqual([0, 250]);
    t.r.wake();
    expect(t.startedAt).toEqual([0, 250, 300]);
    t.r.cancel();

    // During an attempt: the next one skips its delay.
    const { clock, timers } = trackedClock();
    const started: number[] = [];
    let release: (r: AttemptResult) => void = () => {};
    const r = createReconnector({
      clock, frame: () => {}, reconnecting: () => {}, reconnected: () => {}, gaveUp: () => {},
      attempt: () => { started.push(clock.now()); return new Promise<AttemptResult>((res) => { release = res; }); },
    });
    r.dropped(DROP);
    clock.advance(100);
    r.wake();
    release(fail());
    await flush();
    expect(started).toEqual([0, 100]);
    // Only the next delay is skipped, not the ones after: attempt 2 fails and attempt 3 waits its 500 ms.
    release(fail());
    await flush();
    clock.advance(499);
    expect(started).toEqual([0, 100]);
    clock.advance(1);
    expect(started).toEqual([0, 100, 600]);
    r.cancel();
    expect(timers()).toBe(0);
  });

  it('wake with nothing to wake does nothing', () => {
    const t = rig();
    t.r.wake();
    expect(t.startedAt).toEqual([]);
  });

  it('cancel stops waits and aborts the attempt; nothing more is emitted and no timers are left', async () => {
    const t = rig({ hold: true });
    t.r.dropped(DROP);
    await flush();
    const framesBefore = t.frames.length;
    t.r.cancel();
    expect(t.signals[0].aborted).toBe(true);
    expect(t.r.active).toBe(false);
    expect(t.timers()).toBe(0);
    await t.run(60000);
    expect(t.frames.length).toBe(framesBefore);
    expect(t.gaveUp).toEqual([]);
    expect(t.reconnected).toEqual([]);
    t.r.dropped(DROP);
    expect(t.startedAt).toHaveLength(1);

    // Cancelled during a wait.
    const w = rig();
    w.r.dropped(DROP);
    await w.run(10);
    w.r.cancel();
    expect(w.timers()).toBe(0);
    await w.run(60000);
    expect(w.startedAt).toEqual([0]);
    expect(w.gaveUp).toEqual([]);
  });

  it('an attempt answering after cancel emits nothing', async () => {
    const { clock } = trackedClock();
    let release: (r: AttemptResult) => void = () => {};
    const events: string[] = [];
    const r = createReconnector({
      clock, frame: (t) => events.push(t), reconnecting: () => {}, reconnected: () => events.push('reconnected'), gaveUp: () => events.push('gaveUp'),
      attempt: () => new Promise<AttemptResult>((res) => { release = res; }),
    });
    r.dropped(DROP);
    r.cancel();
    release(ok());
    await flush();
    expect(events).toEqual(['session.reconnecting']);
  });

  it('an attempt that throws is a failed attempt', async () => {
    const { clock } = trackedClock();
    const failed: string[] = [];
    const r = createReconnector({
      clock, frame: (t, p) => { if (t === 'session.reconnect_failed') failed.push(String(p.message)); }, reconnecting: () => {}, reconnected: () => {}, gaveUp: () => {},
      attempt: () => Promise.reject(new Error('boom')),
    });
    r.dropped(DROP);
    await flush();
    expect(failed).toEqual(['boom']);
    r.cancel();
  });

  it('frames are written as listed', async () => {
    const t = rig();
    t.answers.push(fail('e1', 'first failure'), ok());
    t.r.dropped({ cause: 'error', errorCode: 'socket_error', retryable: true, managed: false });
    await t.run(250);
    expect(t.frames).toEqual([
      ['session.reconnecting', { cause: 'error', code: 'socket_error' }],
      ['session.reconnect_failed', { attempt: 1, message: 'first failure' }],
      ['session.reconnected', { downMs: 250, attempts: 2 }],
    ]);

    const g = rig();
    g.answers.push({ ok: false, final: true, reason: 'terminal_error', code: 'auth', message: 'bad key' });
    g.r.dropped(DROP);
    await flush();
    expect(g.frames).toEqual([
      ['session.reconnecting', { cause: 'close', code: 1006 }],
      ['session.connection_lost', { attempts: 1 }],
    ]);
  });

  it('ignores a drop while already reconnecting', async () => {
    const t = rig({ hold: true });
    t.r.dropped(DROP);
    t.r.dropped(DROP);
    await flush();
    expect(t.startedAt).toHaveLength(1);
    expect(t.reconnecting).toHaveLength(1);
    t.r.cancel();
  });
});

describe('closeCodeAction', () => {
  it('1000, 1001, 1005, 1006, 1011–1014 reconnect; 1003, 1007–1010, 4000 and undefined end', () => {
    for (const code of [1000, 1001, 1005, 1006, 1011, 1012, 1013, 1014]) expect(closeCodeAction(code), String(code)).toBe('reconnect');
    for (const code of [1003, 1007, 1008, 1009, 1010, 4000]) expect(closeCodeAction(code), String(code)).toBe('end');
    expect(closeCodeAction(undefined)).toBe('end');
  });
});
