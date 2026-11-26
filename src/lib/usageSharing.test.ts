import { describe, expect, it, vi } from 'vitest';
import { attachUsageSharingClient, followUsageSharingSetting, setUsageSharing, usageSharingOn } from './usageSharing';

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

// The extension popup is its own page with its own client: it follows the saved setting in the browser's storage.
describe('following the saved setting (extension popup)', () => {
  const KEY = 'settings.common.shareUsageData';
  const storage = (saved: Record<string, unknown>) => {
    let listener: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
    return {
      area: { get: (key: string, cb: (r: Record<string, unknown>) => void) => cb(key in saved ? { [key]: saved[key] } : {}) },
      onChanged: { addListener: (l: typeof listener) => { listener = l; } },
      change: (area: string, changes: Record<string, { newValue?: unknown }>) => listener?.(changes, area),
    };
  };

  it('opts the client out when the saved choice is off, and in again when it changes', () => {
    const c = client();
    attachUsageSharingClient(c);
    const st = storage({ [KEY]: false });
    followUsageSharingSetting(st.area, st.onChanged, 'sync', KEY);
    expect(c.optOut).toHaveBeenCalledTimes(1);
    st.change('sync', { [KEY]: { newValue: true } });
    expect(c.optIn).toHaveBeenCalledTimes(1);
  });

  it('treats nothing saved as sharing, and ignores other keys and other storage areas', () => {
    const c = client(true);
    attachUsageSharingClient(c);
    const st = storage({});
    followUsageSharingSetting(st.area, st.onChanged, 'sync', KEY);
    expect(c.optIn).toHaveBeenCalledTimes(1);
    st.change('local', { [KEY]: { newValue: false } });
    st.change('sync', { other: { newValue: false } });
    expect(c.optOut).not.toHaveBeenCalled();
  });

  it('leaves the client as it is when the saved choice cannot be read', () => {
    const c = client(true);
    attachUsageSharingClient(c);
    // Attaching settles the client by what earlier tests left known; only what the failed read does counts here.
    c.optIn.mockClear();
    c.optOut.mockClear();
    const st = storage({});
    const failing = { get: (_key: string, cb: (r?: Record<string, unknown>) => void) => cb(undefined) };
    expect(() => followUsageSharingSetting(failing as never, st.onChanged, 'sync', KEY)).not.toThrow();
    expect(c.optIn).not.toHaveBeenCalled();
    expect(c.optOut).not.toHaveBeenCalled();
  });
});
