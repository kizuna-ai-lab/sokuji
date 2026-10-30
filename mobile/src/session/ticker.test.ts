import { describe, it, expect } from 'vitest';
import { createTicker } from './ticker';

// On Android, React Native's setTimeout stops firing once the activity is in the
// background (the screen off), while the recorder's audio callback keeps coming every
// 100 ms. Every wait the session makes therefore hangs off this ticker, which anything
// that keeps running (the audio callback, a foreground interval) advances.
const clock = () => { let t = 0; return { now: () => t, set: (v: number) => { t = v; } }; };

describe('ticker', () => {
  it('runs a callback on the first tick at or after its due time, once', () => {
    const c = clock(); const tk = createTicker(c.now);
    let runs = 0;
    tk.after(2000, () => { runs += 1; });
    c.set(1999); tk.tick();
    expect(runs).toBe(0);
    c.set(2000); tk.tick();
    expect(runs).toBe(1);
    c.set(9000); tk.tick();
    expect(runs).toBe(1);
  });

  it('never runs a cancelled callback', () => {
    const c = clock(); const tk = createTicker(c.now);
    let runs = 0;
    const cancel = tk.after(100, () => { runs += 1; });
    cancel();
    c.set(500); tk.tick();
    expect(runs).toBe(0);
  });

  it('runs callbacks that fell due together in due order', () => {
    const c = clock(); const tk = createTicker(c.now);
    const order: string[] = [];
    tk.after(300, () => order.push('b'));
    tk.after(100, () => order.push('a'));
    c.set(1000); tk.tick();
    expect(order).toEqual(['a', 'b']);
  });

  it('resolves sleep() only after a tick past the delay', async () => {
    const c = clock(); const tk = createTicker(c.now);
    let done = false;
    const p = tk.sleep(500).then(() => { done = true; });
    c.set(499); tk.tick();
    await Promise.resolve();
    expect(done).toBe(false);
    c.set(500); tk.tick();
    await p;
    expect(done).toBe(true);
  });

  it('resolves sleep() at once when its signal aborts, with no tick', async () => {
    const c = clock(); const tk = createTicker(c.now);
    const ctl = new AbortController();
    const p = tk.sleep(60000, ctl.signal);
    ctl.abort();
    await p;
    expect(tk.pending()).toBe(0);
  });
});
