import { describe, it, expect, afterEach, vi } from 'vitest';
import { SettingsService } from './SettingsService';

/**
 * `setSetting` is typed `Promise<SettingsOperationResult>` — a result, not a
 * rejection. It did not honour that in the extension build: the Chrome branch
 * `return new Promise(...)`s from inside the `try` WITHOUT awaiting, so a
 * synchronous throw inside the executor (a `chrome.storage` binding that has
 * gone away after "Extension context invalidated") rejected straight past the
 * catch. Only the localStorage branch was fully converted.
 *
 * That mattered because it made the contract ambiguous: 31 call sites wrapped
 * the call in `.catch(...)` for a rejection that the Electron build could never
 * produce, while none of them read `result.success` — so the failure the service
 * actually reports was dropped everywhere, and the one it was guarded against
 * only existed on one platform.
 */
const withChromeStorage = (set: (key: unknown, cb: () => void) => void) => {
  (globalThis as Record<string, unknown>).chrome = {
    storage: { sync: { set, get: (_k: unknown, cb: (r: unknown) => void) => cb({}) } },
    runtime: { lastError: undefined },
  };
};

describe('SettingsService.getSetting', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
    vi.restoreAllMocks();
  });

  // The same un-awaited-promise shape as setSetting had. A getter that takes a
  // default must not be able to reject: every caller treats it as total.
  it('falls back to the default when chrome.storage throws synchronously', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as Record<string, unknown>).chrome = {
      storage: { sync: { get: () => { throw new Error('Extension context invalidated.'); }, set: (_k: unknown, cb: () => void) => cb() } },
      runtime: { lastError: undefined },
    };

    await expect(new SettingsService().getSetting('settings.common.textOnly', true))
      .resolves.toBe(true);
  });

  it('falls back to the default when the chrome.storage binding is gone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as Record<string, unknown>).chrome = {
      storage: { sync: { get: undefined, set: (_k: unknown, cb: () => void) => cb() } },
      runtime: { lastError: undefined },
    };

    await expect(new SettingsService().getSetting('settings.common.textOnly', 'fallback'))
      .resolves.toBe('fallback');
  });
});

describe('SettingsService localStorage round trips', () => {
  afterEach(() => {
    localStorage.clear();
    delete (globalThis as Record<string, unknown>).chrome;
    vi.restoreAllMocks();
  });

  it.each([
    '123456',
    'true',
    'false',
    'null',
    '[]',
    '{}',
    '"quoted"',
  ])('preserves the JSON-looking string %j exactly', async (value) => {
    const service = new SettingsService();
    const key = 'settings.test.opaqueString';

    await expect(service.setSetting(key, value)).resolves.toMatchObject({ success: true });
    expect(localStorage.getItem(key)).toBe(value);

    const restored = await service.getSetting(key, '');
    expect(restored).toBe(value);
    expect(typeof restored).toBe('string');
  });

  it.each([
    ['boolean', true],
    ['number', 123456],
    ['array', ['one', 'two']],
    ['object', { enabled: true }],
  ])('keeps parsing a stored %s value', async (_label, value) => {
    const service = new SettingsService();
    const key = 'settings.test.structuredValue';

    await expect(service.setSetting(key, value)).resolves.toMatchObject({ success: true });
    await expect(service.getSetting(key, null)).resolves.toEqual(value);
  });
});

describe('SettingsService.setSetting', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
    vi.restoreAllMocks();
  });

  it('resolves { success: false } when chrome.storage throws synchronously', async () => {
    withChromeStorage(() => {
      throw new Error('Extension context invalidated.');
    });

    const result = await new SettingsService().setSetting('settings.common.textOnly', true);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Extension context invalidated');
  });

  it('resolves { success: false } when the chrome.storage binding is gone', async () => {
    (globalThis as Record<string, unknown>).chrome = {
      storage: { sync: { set: undefined, get: (_k: unknown, cb: (r: unknown) => void) => cb({}) } },
      runtime: { lastError: undefined },
    };

    const result = await new SettingsService().setSetting('settings.common.textOnly', true);

    expect(result.success).toBe(false);
  });

  it('reports chrome.runtime.lastError as a failed result', async () => {
    withChromeStorage((_key, cb) => {
      const g = globalThis as unknown as { chrome: { runtime: { lastError?: { message: string } } } };
      g.chrome.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
      cb();
    });

    const result = await new SettingsService().setSetting('settings.common.textOnly', true);

    expect(result.success).toBe(false);
    expect(result.error).toContain('quota exceeded');
  });

  it('resolves { success: true } on a normal write', async () => {
    withChromeStorage((_key, cb) => cb());

    const result = await new SettingsService().setSetting('settings.common.textOnly', true);

    expect(result.success).toBe(true);
  });

  it('resolves { success: false } when localStorage throws (Electron path)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const result = await new SettingsService().setSetting('settings.common.textOnly', true);

    expect(result.success).toBe(false);
    expect(result.error).toContain('QuotaExceededError');
  });
});
