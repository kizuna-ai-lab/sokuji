import { describe, expect, it } from 'vitest';
import { createPageGate } from './pageGate';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createPageGate', () => {
  it('hands a request its result while the user is still on its page', async () => {
    const gate = createPageGate();
    const seen: string[] = [];
    await gate.run(async () => 'ok', { done: (v) => seen.push(`done ${v}`), settled: () => seen.push('settled') });
    expect(seen).toEqual(['done ok', 'settled']);
  });

  it('drops the result of a request whose page was left (Back while sending)', async () => {
    const gate = createPageGate();
    const send = deferred<void>();
    const seen: string[] = [];
    const running = gate.run(() => send.promise, { done: () => seen.push('done'), failed: () => seen.push('failed'), settled: () => seen.push('settled') });
    gate.leave();
    send.resolve();
    await running;
    expect(seen).toEqual([]);
  });

  it('drops a late failure too, so its error does not appear on another page', async () => {
    const gate = createPageGate();
    const send = deferred<void>();
    const seen: string[] = [];
    const running = gate.run(() => send.promise, { failed: () => seen.push('failed') });
    gate.leave();
    send.reject(new Error('429'));
    await running;
    expect(seen).toEqual([]);
  });
});
