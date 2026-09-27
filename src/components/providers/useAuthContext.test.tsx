import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  isLoaded: false,
  isSignedIn: false,
  userId: undefined as string | undefined,
  getToken: async () => null,
  error: null as Error | null,
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => auth,
}));

import type { AuthContext } from '../../lib/provider/types';
import { AuthStandIn, useAuthContext } from './useAuthContext';

describe('useAuthContext', () => {
  it('is the sign-in, with whether it has loaded', () => {
    auth.isLoaded = false;
    auth.isSignedIn = false;
    auth.userId = undefined;
    const { result } = renderHook(() => useAuthContext());
    expect(result.current).toEqual({ signedIn: false, loaded: false, userId: null, getToken: auth.getToken });
  });

  it('has not loaded while the answer is a signed-out one that carries an error — a session fetch that failed — and has once a plain one comes', () => {
    auth.isLoaded = true;
    auth.userId = undefined;
    try {
      // Better Auth reports a failed session fetch (offline, a backend stall) as loaded and signed out, with an error.
      auth.isSignedIn = false;
      auth.error = new Error('Failed to fetch');
      expect(renderHook(() => useAuthContext()).result.current).toMatchObject({ signedIn: false, loaded: false });

      auth.error = null;
      expect(renderHook(() => useAuthContext()).result.current).toMatchObject({ signedIn: false, loaded: true });

      // A signed-in answer is an answer, error or not.
      auth.isSignedIn = true;
      auth.userId = 'u1';
      auth.error = new Error('Failed to fetch');
      expect(renderHook(() => useAuthContext()).result.current).toMatchObject({ signedIn: true, loaded: true });
    } finally {
      auth.isSignedIn = false;
      auth.userId = undefined;
      auth.error = null;
    }
  });

  it('answers the stand-in when one is provided', () => {
    const standIn: AuthContext = { signedIn: true, loaded: true, userId: 'stand-in', getToken: async () => 'x' };
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: ({ children }) => <AuthStandIn.Provider value={standIn}>{children}</AuthStandIn.Provider>,
    });
    expect(result.current).toBe(standIn);
  });
});
