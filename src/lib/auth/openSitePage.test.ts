import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.fn();
vi.mock('../auth-client', () => ({ authClient: { oneTimeToken: { generate: (...a: unknown[]) => generate(...a) } } }));
let electron = false;
vi.mock('../../utils/environment', () => ({
  isElectron: () => electron,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

import { openSitePage } from './openSitePage';

let open: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  generate.mockReset();
  electron = false;
  open = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  open.mockRestore();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('openSitePage', () => {
  it('signs the browser in with a one-time token and lands on the page asked for', async () => {
    generate.mockResolvedValue({ data: { token: 'T' }, error: null });
    const onSessionExpired = vi.fn();
    await expect(openSitePage('/dashboard/billing', { signedIn: true, onSessionExpired })).resolves.toBe('opened');
    expect(open).toHaveBeenCalledWith('https://sokuji.kizuna.ai/api/ott/verify?token=T&redirect=%2Fdashboard%2Fbilling', '_blank');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('opens nothing when the session is gone, and says so', async () => {
    generate.mockResolvedValue({ data: null, error: { status: 401 } });
    const onSessionExpired = vi.fn();
    await expect(openSitePage('/dashboard/billing', { signedIn: true, onSessionExpired })).resolves.toBe('session-expired');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the plain page when the token cannot be had for another reason', async () => {
    generate.mockResolvedValue({ data: null, error: { status: 500 } });
    await openSitePage('/dashboard/billing', { signedIn: true, onSessionExpired: vi.fn() });
    expect(open).toHaveBeenCalledWith('https://sokuji.kizuna.ai/dashboard/billing', '_blank');
    generate.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openSitePage('/dashboard', { signedIn: true, onSessionExpired: vi.fn() });
    expect(open).toHaveBeenLastCalledWith('https://sokuji.kizuna.ai/dashboard', '_blank');
    warn.mockRestore();
  });

  it('asks for no token when signed out', async () => {
    await openSitePage('/dashboard/billing', { signedIn: false, onSessionExpired: vi.fn() });
    expect(generate).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://sokuji.kizuna.ai/dashboard/billing', '_blank');
  });

  it('opens the system browser on the desktop, and survives the call failing', async () => {
    electron = true;
    const invoke = vi.fn().mockRejectedValue(new Error('no main process'));
    (window as unknown as { electron: unknown }).electron = { invoke };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openSitePage('/dashboard/billing', { signedIn: false, onSessionExpired: vi.fn() });
    expect(invoke).toHaveBeenCalledWith('open-external', 'https://sokuji.kizuna.ai/dashboard/billing');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
