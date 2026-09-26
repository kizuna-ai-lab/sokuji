import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { ResourceStack, type ReleaseFailure } from './stack';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(timeoutMs = 1000) {
  const clock = createVirtualClock();
  const failures: ReleaseFailure[] = [];
  const stack = new ResourceStack(clock, timeoutMs, (f) => failures.push(f));
  return { clock, failures, stack };
}

describe('ResourceStack', () => {
  it('releases the last pushed first, one at a time', async () => {
    const { stack } = setup();
    const order: string[] = [];
    let finishLease!: () => void;
    stack.defer('lease', async () => { order.push('lease'); });
    stack.defer('session', () => new Promise<void>((resolve) => { order.push('session:start'); finishLease = () => { order.push('session:done'); resolve(); }; }));
    stack.defer('listener', () => { order.push('listener'); });
    const done = stack.unwind();
    await flush();
    expect(order).toEqual(['listener', 'session:start']);
    finishLease();
    await done;
    expect(order).toEqual(['listener', 'session:start', 'session:done', 'lease']);
  });

  it('reports a release that throws or rejects, and still runs the rest', async () => {
    const { stack, failures } = setup();
    const released: string[] = [];
    stack.defer('a', () => { released.push('a'); });
    stack.defer('b', async () => { throw new Error('socket stuck'); });
    stack.defer('c', () => { throw new Error('bad'); });
    await stack.unwind();
    expect(released).toEqual(['a']);
    expect(failures).toEqual([{ name: 'c', message: 'bad' }, { name: 'b', message: 'socket stuck' }]);
  });

  it('gives up on a release that overruns its timeout, and moves on', async () => {
    const { stack, failures, clock } = setup(500);
    let released = false;
    stack.defer('first', () => { released = true; });
    stack.defer('hangs', () => new Promise<void>(() => {}));
    const done = stack.unwind();
    await flush();
    clock.advance(500);
    await done;
    expect(released).toBe(true);
    expect(failures).toEqual([{ name: 'hangs', message: 'timed out after 500 ms' }]);
  });

  it('unwinds once: every call returns the same promise', async () => {
    const { stack } = setup();
    let n = 0;
    stack.defer('x', () => { n++; });
    const a = stack.unwind();
    const b = stack.unwind();
    expect(a).toBe(b);
    await a;
    expect(n).toBe(1);
    expect(stack.unwound).toBe(true);
  });

  it('releases at once what is pushed after unwinding began', async () => {
    const { stack } = setup();
    await stack.unwind();
    let released = false;
    stack.defer('late session', () => { released = true; });
    await flush();
    expect(released).toBe(true);
  });

  it('abandon fires every release now, last first, without waiting for any', () => {
    const stack = new ResourceStack(createVirtualClock(0), 1000, () => {});
    const calls: string[] = [];
    stack.defer('a', () => { calls.push('a'); });
    stack.defer('b', () => new Promise<void>(() => { calls.push('b'); }));
    stack.defer('c', () => { calls.push('c'); });
    stack.abandon();
    expect(calls).toEqual(['c', 'b', 'a']);
    stack.defer('late', () => { calls.push('late'); });
    expect(calls).toEqual(['c', 'b', 'a', 'late']);
  });

  it('a release that throws synchronously during abandon is reported, and does not stop the releases below it', () => {
    const { stack, failures } = setup();
    const released: string[] = [];
    stack.defer('a', () => { released.push('a'); });
    stack.defer('boom', () => { throw new Error('socket stuck'); });
    stack.defer('c', () => { released.push('c'); });
    stack.abandon();
    expect(released).toEqual(['c', 'a']);
    expect(failures).toEqual([{ name: 'boom', message: 'socket stuck' }]);
  });

  it('a release that rejects later during abandon is reported, and does not stop the releases below it', async () => {
    const { stack, failures } = setup();
    const released: string[] = [];
    stack.defer('a', () => { released.push('a'); });
    stack.defer('boom', () => Promise.reject(new Error('socket stuck')));
    stack.defer('c', () => { released.push('c'); });
    stack.abandon();
    expect(released).toEqual(['c', 'a']);
    expect(failures).toEqual([]);
    await flush();
    expect(failures).toEqual([{ name: 'boom', message: 'socket stuck' }]);
  });
});
