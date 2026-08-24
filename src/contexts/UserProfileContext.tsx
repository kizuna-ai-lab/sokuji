/**
 * User Profile Context
 * Provides user data from Better Auth and quota information from backend API
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, useUser } from '../lib/auth/hooks';
import { useIsSessionActive } from '../stores/sessionStore';
import { getApiUrl } from '../utils/environment';
import { mapWalletStatusToQuota } from '../utils/walletQuota';

export interface QuotaData {
  // Core wallet data (new fields)
  balance?: number;      // Wallet balance in micro-USD (never expires)
  frozen?: boolean;      // Whether wallet is frozen

  // Usage statistics (new fields)
  monthlyQuota?: number;     // Micro-USD allocated monthly for this plan
  last30DaysUsage?: number;  // Micro-USD used in the past 30 days

  // Compatibility fields (for frontend UI)
  total: number;         // = balance (for compatibility)
  used: number;          // = 0 (wallet model doesn't track usage)
  remaining: number;     // = balance (if not frozen) or 0 (if frozen)
  resetDate?: string | null;  // = null (no reset in wallet model)
  plan: string;          // Current subscription plan

  // Additional features (new fields)
  features?: string[];   // Enabled features for the plan
  rateLimitRpm?: number; // Rate limit (requests per minute)
  maxConcurrentSessions?: number; // Max concurrent sessions allowed
}

interface UserProfileContextValue {
  // User data from Better Auth
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
    subscription: 'free' | 'starter' | 'essentials' | 'professional' | 'business' | 'enterprise' | 'unlimited';
    createdAt: number;
    updatedAt: number;
  } | null;
  // Quota data from backend
  quota: QuotaData | null;
  isLoading: boolean;
  error: string | null;
  refetchQuota: () => Promise<void>;
  refetchProfile: () => Promise<void>;
  refetchAll: () => Promise<void>;
}

const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined);

export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within UserProfileProvider');
  }
  return context;
}

interface UserProfileProviderProps {
  children: React.ReactNode;
}

export function UserProfileProvider({ children }: UserProfileProviderProps) {
  const { isSignedIn, getToken } = useAuth();
  const { user: betterAuthUser } = useUser();
  const isSessionActive = useIsSessionActive();

  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which session the state currently belongs to, so a response can be checked
  // against it before being written. Both fetches await a network round-trip
  // and then call setQuota; without this, a sign-out mid-flight is undone by
  // the response landing afterwards, and signing in as someone else shows the
  // previous account's balance — which also gates managed sessions, so it is
  // more than a display problem. Updated in the same effect that clears the
  // quota, so the two can never disagree.
  const activeSessionRef = useRef<string | null>(null);

  // Extract stable user ID to prevent infinite loops
  const userId = betterAuthUser?.id;

  // Transform Better Auth user data to our format
  // Note: subscription now comes from quota API
  const user = betterAuthUser ? {
    id: betterAuthUser.id,
    email: betterAuthUser.email || '',
    firstName: betterAuthUser.name?.split(' ')[0] || undefined,
    lastName: betterAuthUser.name?.split(' ').slice(1).join(' ') || undefined,
    imageUrl: betterAuthUser.image || undefined,
    subscription: (quota?.plan as 'free' | 'starter' | 'essentials' | 'professional' | 'business' | 'enterprise' | 'unlimited') || 'free',  // Get from quota API
    createdAt: betterAuthUser.createdAt ? new Date(betterAuthUser.createdAt).getTime() : Date.now(),
    updatedAt: betterAuthUser.updatedAt ? new Date(betterAuthUser.updatedAt).getTime() : Date.now()
  } : null;

  // Function to fetch quota data from backend
  const fetchQuota = useCallback(async () => {
    if (!isSignedIn || !betterAuthUser) {
      setQuota(null);
      return;
    }

    // Captured now, compared after every await. See activeSessionRef.
    const requestedFor = userId ?? null;
    const stale = () => activeSessionRef.current !== requestedFor;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`${getApiUrl()}/wallet/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (stale()) return;

      if (!response.ok) {
        const errorMessage = `Failed to fetch quota: ${response.status} ${response.statusText}`;
        setError(errorMessage);
        console.error('[UserProfileContext]', errorMessage);
        return;
      }

      const raw = await response.json();
      if (stale()) return;

      setQuota(mapWalletStatusToQuota(raw));
      setError(null);
    } catch (err: any) {
      if (stale()) return;
      const errorMessage = err.message || 'Failed to fetch quota';
      setError(errorMessage);
      console.error('[UserProfileContext] Error fetching quota:', err);
      setQuota(null);
    } finally {
      // The loading flag belongs to whoever owns the state now. A stale request
      // clearing it would report the current session's fetch as finished.
      if (!stale()) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId]); // Use userId instead of betterAuthUser to prevent infinite loops

  // Function to refresh only quota data silently (for periodic updates during sessions)
  const fetchQuotaSilently = useCallback(async () => {
    if (!isSignedIn || !betterAuthUser) return;

    // Same guard as fetchQuota: polling runs on a timer, so a tick can easily
    // still be in flight when the session ends.
    const requestedFor = userId ?? null;
    const stale = () => activeSessionRef.current !== requestedFor;

    try {
      const token = await getToken();
      if (!token) {
        console.warn('[UserProfileContext] No token available for silent fetch');
        return;
      }

      const response = await fetch(`${getApiUrl()}/wallet/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const raw = await response.json();
        if (stale()) return;
        setQuota(mapWalletStatusToQuota(raw));
        setError(null);
      } else {
        console.warn('[UserProfileContext] Silent fetch failed:', response.status, response.statusText);
      }
    } catch (err: any) {
      console.warn('[UserProfileContext] Silent fetch error:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId]); // Use userId instead of betterAuthUser to prevent infinite loops

  // Fetch quota on mount and when user changes
  useEffect(() => {
    // Stamp the session BEFORE dispatching, so any response already in flight
    // for a previous session fails its check when it lands.
    activeSessionRef.current = isSignedIn && userId ? userId : null;

    if (isSignedIn && userId) {
      fetchQuota();
    } else {
      // fetchQuota has a signed-out branch that clears the quota, but it was
      // unreachable: this effect only ever called it while signed in, so a
      // sign-out left the previous user's balance on screen. That stale balance
      // is the reason sign-out reached for window.location.reload().
      setQuota(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId]); // Depend on stable values, not the function

  // Refresh quota with dynamic interval based on session state
  useEffect(() => {
    if (!isSignedIn || !userId) return;

    // Use session-aware intervals: 1 min active, 5 min idle
    const interval = isSessionActive ? 60 * 1000 : 5 * 60 * 1000;

    console.log('[UserProfileContext] Setting up polling with interval:', Math.round(interval / 1000), 'seconds');
    const intervalId = setInterval(() => {
      fetchQuotaSilently();
    }, interval);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, isSessionActive, userId]); // Depend on stable values, not the function

  // Function to refresh user profile from Better Auth
  const refetchProfile = useCallback(async () => {
    try {
      // Better Auth session is automatically refreshed
      // No manual reload needed
    } catch (error) {
      console.error('[UserProfileContext] Error refreshing profile:', error);
    }
  }, []);

  // Function to refresh both profile and quota
  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchProfile(),
      fetchQuota()
    ]);
  }, [refetchProfile, fetchQuota]);

  const value: UserProfileContextValue = {
    user,
    quota,
    isLoading,
    error,
    refetchQuota: fetchQuota,
    refetchProfile,
    refetchAll,
  };

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
}
