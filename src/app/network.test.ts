import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserNetwork } from './network';

// jsdom has no navigator.connection; a test installs one and removes it.
const setConnection = (value: unknown) => {
  Object.defineProperty(navigator, 'connection', { value, configurable: true });
};

afterEach(() => {
  delete (navigator as unknown as { connection?: unknown }).connection;
});

describe('createBrowserNetwork', () => {
  it('maps wifi, cellular and ethernet, and anything else to unknown', () => {
    const network = createBrowserNetwork();
    for (const type of ['wifi', 'cellular', 'ethernet'] as const) {
      setConnection({ type });
      expect(network.type()).toBe(type);
    }
    for (const type of ['bluetooth', 'none', 'other', undefined]) {
      setConnection({ type });
      expect(network.type()).toBe('unknown');
    }
  });

  it('is unknown when the browser has no connection API', () => {
    expect(createBrowserNetwork().type()).toBe('unknown');
  });

  it('reads navigator.onLine', () => {
    expect(createBrowserNetwork().online()).toBe(navigator.onLine);
  });

  it('fires onOnline on an online event, and stops after unsubscribe', () => {
    const network = createBrowserNetwork();
    let calls = 0;
    const off = network.onOnline(() => { calls += 1; });
    window.dispatchEvent(new Event('online'));
    expect(calls).toBe(1);
    off();
    window.dispatchEvent(new Event('online'));
    expect(calls).toBe(1);
  });
});
