import { describe, expect, it, vi } from 'vitest';
import { attachUsageSharingClient, setUsageSharing, usageSharingOn } from './usageSharing';

// Like the real client, it remembers its own choice.
const client = (optedOut = false) => {
  const c = { optedOut, optIn: vi.fn(() => { c.optedOut = false; }), optOut: vi.fn(() => { c.optedOut = true; }) };
  return c;
};

describe('usage sharing', () => {
  // The client keeps its own opt-out across restarts; until the setting is read, nothing may undo it, and a user who
  // shares must not send an `$opt_in` event at every start.
  it('leaves a client alone until the setting is known, then opts in only if it is opted out', async () => {
    vi.resetModules();
    const m = await import('./usageSharing');
    const out = client(true);
    m.attachUsageSharingClient(out);
    expect(out.optIn).not.toHaveBeenCalled();
    expect(out.optOut).not.toHaveBeenCalled();
    m.setUsageSharing(true);
    expect(out.optIn).toHaveBeenCalledTimes(1);
    const inn = client(false);
    m.attachUsageSharingClient(inn);
    expect(inn.optIn).not.toHaveBeenCalled();
    m.setUsageSharing(false);
    expect(inn.optOut).toHaveBeenCalledTimes(1);
  });

  it('is on until the user turns it off', () => {
    setUsageSharing(true);
    expect(usageSharingOn()).toBe(true);
  });

  // The analytics client is built after the UI is up, and the setting is read around the same time:
  // whichever comes second must still settle the client.
  it('opts a client out that arrives after the user turned sharing off', () => {
    setUsageSharing(false);
    const c = client();
    attachUsageSharingClient(c);
    expect(c.optOut).toHaveBeenCalledTimes(1);
    expect(c.optIn).not.toHaveBeenCalled();
  });

  it('opts a client that is already there out, and back in', () => {
    setUsageSharing(true);
    const c = client();
    attachUsageSharingClient(c);
    c.optIn.mockClear();
    setUsageSharing(false);
    expect(c.optOut).toHaveBeenCalledTimes(1);
    setUsageSharing(true);
    expect(c.optIn).toHaveBeenCalledTimes(1);
    expect(usageSharingOn()).toBe(true);
  });

  it('keeps going without a client (a build with no analytics key)', () => {
    attachUsageSharingClient(null);
    expect(() => setUsageSharing(false)).not.toThrow();
    setUsageSharing(true);
  });
});
