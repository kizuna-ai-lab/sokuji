import { describe, expect, it } from 'vitest';
import { createBusyGuard } from './busy';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createBusyGuard', () => {
  it('ignores a second tap while the first is still running, and says so', async () => {
    const changes: boolean[] = [];
    const guard = createBusyGuard((busy) => changes.push(busy));
    const first = deferred();
    let calls = 0;
    const action = () => { calls += 1; return first.promise; };

    const a = guard.run(action);
    expect(guard.run(action)).toBeNull();
    expect(calls).toBe(1);
    expect(guard.busy()).toBe(true);

    first.resolve();
    await a;
    expect(guard.busy()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('is free again after the action fails, and passes the failure on', async () => {
    const guard = createBusyGuard(() => {});
    await expect(guard.run(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(guard.busy()).toBe(false);
    let ran = false;
    await guard.run(async () => { ran = true; });
    expect(ran).toBe(true);
  });

  it('is free again after an action that throws before its first await', async () => {
    const guard = createBusyGuard(() => {});
    await expect(guard.run(() => { throw new Error('bad'); })).rejects.toThrow('bad');
    expect(guard.busy()).toBe(false);
  });
});
