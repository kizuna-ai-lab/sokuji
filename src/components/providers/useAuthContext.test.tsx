import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  isLoaded: false,
  isSignedIn: false,
  userId: undefined as string | undefined,
  getToken: async () => null,
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

  it('answers the stand-in when one is provided', () => {
    const standIn: AuthContext = { signedIn: true, loaded: true, userId: 'stand-in', getToken: async () => 'x' };
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: ({ children }) => <AuthStandIn.Provider value={standIn}>{children}</AuthStandIn.Provider>,
    });
    expect(result.current).toBe(standIn);
  });
});
