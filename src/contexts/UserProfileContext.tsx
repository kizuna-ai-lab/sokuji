/**
 * User Profile Context
 * Provides user data from Clerk and quota information from backend API
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
  // User data directly from Clerk
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
      const response = await fetch(`${apiUrl}/api/wallet/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Not authenticated');
        } else {
          throw new Error(`Failed to fetch quota: ${response.statusText}`);
        }
      }
      
      const quotaData = await response.json();
      setQuota(quotaData);
      setError(null);
    } catch (err: any) {
      console.error('[UserProfileContext] Error fetching quota:', err);
      setError(err.message || 'Failed to fetch quota');
      setQuota(null);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, betterAuthUser, getToken]);

  // Function to refresh only quota data silently (for periodic updates during sessions)
  const fetchQuotaSilently = useCallback(async () => {
    if (!isSignedIn || !betterAuthUser) return;

    try {
      const token = await getToken();
      if (!token) return;

      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
      const response = await fetch(`${apiUrl}/api/wallet/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const quotaData = await response.json();
        setQuota(quotaData);
      }
    } catch (err: any) {
      console.error('[UserProfileContext] Error fetching quota:', err);
      // Don't set error state for silent refreshes to avoid disrupting UI
    }
  }, [isSignedIn, betterAuthUser, getToken]);

  // Fetch quota on mount and when user changes
  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  // Refresh quota every minute when session is active
  useEffect(() => {
    if (!isSignedIn || !isSessionActive) return;

    const interval = setInterval(() => {
      fetchQuotaSilently();
    }, 60 * 1000); // 1 minute

    return () => clearInterval(interval);
  }, [isSignedIn, isSessionActive, fetchQuotaSilently]);

  // Refresh quota every 5 minutes when not in session
  useEffect(() => {
    if (!isSignedIn || isSessionActive) return;

    const interval = setInterval(() => {
      fetchQuotaSilently();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [isSignedIn, isSessionActive, fetchQuotaSilently]);

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
    refetchAll
  };

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
}