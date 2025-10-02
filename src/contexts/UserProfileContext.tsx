/**
 * User Profile Context
 * Provides user data from Better Auth and quota information from backend API
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '../lib/auth/hooks';
import { useIsSessionActive } from '../stores/sessionStore';

interface QuotaData {
  // Core wallet data (new fields)
  balance?: number;      // Wallet balance (never expires)
  frozen?: boolean;      // Whether wallet is frozen

  // Usage statistics (new fields)
  monthlyQuota?: number;     // Tokens allocated monthly for this plan
  last30DaysUsage?: number;  // Tokens used in the past 30 days

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

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
      const response = await fetch(`${apiUrl}/wallet/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorMessage = `Failed to fetch quota: ${response.status} ${response.statusText}`;
        setError(errorMessage);
        console.error('[UserProfileContext]', errorMessage);
        return;
      }

      const quotaData = await response.json();
      setQuota(quotaData);
      setError(null);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch quota';
      setError(errorMessage);
      console.error('[UserProfileContext] Error fetching quota:', err);
      setQuota(null);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId]); // Use userId instead of betterAuthUser to prevent infinite loops

  // Function to refresh only quota data silently (for periodic updates during sessions)
  const fetchQuotaSilently = useCallback(async () => {
    if (!isSignedIn || !betterAuthUser) return;

    try {
      const token = await getToken();
      if (!token) {
        console.warn('[UserProfileContext] No token available for silent fetch');
        return;
      }

      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
      const response = await fetch(`${apiUrl}/wallet/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const quotaData = await response.json();
        setQuota(quotaData);
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
    if (isSignedIn && userId) {
      fetchQuota();
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
