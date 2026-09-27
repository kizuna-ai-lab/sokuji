import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ProviderAccount } from '../../lib/provider/types';
import type { SonioxRegion } from '../../lib/soniox/regions';
import type { VoiceLibrarySource } from '../../components/Settings/sections/voiceLibrarySource';
import { setManagedVoiceStandIn, useManagedVoiceSource } from './managedVoiceSource';

afterEach(() => {
  setManagedVoiceStandIn(null);
  vi.unstubAllGlobals();
});

const account = (userId: string, getToken: () => Promise<string | null>): ProviderAccount => ({
  credentials: {},
  auth: { signedIn: true, userId, getToken },
});
const signedOut = (getToken: () => Promise<string | null>): ProviderAccount => ({
  credentials: {},
  auth: { signedIn: false, getToken },
});

describe('useManagedVoiceSource', () => {
  it('no source while signed out', () => {
    const getToken = async () => 'tok';
    const { result } = renderHook(
      ({ a, r }: { a: ProviderAccount | undefined; r: SonioxRegion }) => useManagedVoiceSource(a, r),
      { initialProps: { a: signedOut(getToken), r: 'us' as SonioxRegion } }
    );
    expect(result.current).toBeNull();

    const { result: noAccount } = renderHook(() => useManagedVoiceSource(undefined, 'us'));
    expect(noAccount.current).toBeNull();
  });

  it('one source per account and region, filed under the account', () => {
    const getToken = async () => 'tok';
    const { result, rerender } = renderHook(
      ({ a, r }: { a: ProviderAccount; r: SonioxRegion }) => useManagedVoiceSource(a, r),
      { initialProps: { a: account('u1', getToken), r: 'us' as SonioxRegion } }
    );
    const first = result.current;
    expect(first).not.toBeNull();
    expect(first!.cacheNamespace).toBe('managed:us');

    // A new account object, same user and same getToken: the memo must not churn.
    rerender({ a: account('u1', getToken), r: 'us' });
    expect(result.current).toBe(first);

    rerender({ a: account('u1', getToken), r: 'eu' });
    expect(result.current).not.toBe(first);
    expect(result.current!.cacheNamespace).toBe('managed:eu');

    const second = result.current;
    rerender({ a: account('u2', getToken), r: 'eu' });
    expect(result.current).not.toBe(second);
  });

  it("the preview's stand-in replaces it, and nothing calls the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const standIn: VoiceLibrarySource = {
      list: async () => [],
      create: vi.fn(),
      delete: vi.fn(),
      waitUntilReady: vi.fn(),
      canPreview: false,
    };
    setManagedVoiceStandIn(standIn);
    const getToken = async () => 'tok';
    const { result, rerender } = renderHook(
      ({ a }: { a: ProviderAccount }) => useManagedVoiceSource(a, 'us'),
      { initialProps: { a: account('u1', getToken) } }
    );
    expect(result.current).toBe(standIn);
    await result.current!.list();
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ a: signedOut(getToken) as ProviderAccount });
    expect(result.current).toBeNull();
  });
});
