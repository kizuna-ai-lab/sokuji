/**
 * User Profile Context
 * Provides user data from Clerk and quota information from backend API
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '../lib/clerk/ClerkProvider';
import { useSession } from './SessionContext';

interface QuotaData {
  total: number;
  used: number;
  remaining: number;
  resetDate?: string;
}

interface UserProfileContextValue {
  // User data directly from Clerk
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
    subscription: 'free' | 'basic' | 'premium' | 'enterprise';
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
  const { user: clerkUser } = useUser();
  const { isSessionActive } = useSession();
  
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transform Clerk user data to our format
  const user = clerkUser ? {
    id: clerkUser.id,
    email: clerkUser.primaryEmailAddress?.emailAddress || '',
    firstName: clerkUser.firstName || undefined,
    lastName: clerkUser.lastName || undefined,
    imageUrl: clerkUser.imageUrl || undefined,
    subscription: (clerkUser.publicMetadata?.subscription as 'free' | 'basic' | 'premium' | 'enterprise') || 'free',
    createdAt: clerkUser.createdAt?.getTime() || Date.now(),
    updatedAt: clerkUser.updatedAt?.getTime() || Date.now()
  } : null;

  // Function to fetch quota data from backend
  const fetchQuota = useCallback(async () => {
    if (!isSignedIn || !clerkUser) {
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
      const response = await fetch(`${apiUrl}/api/usage/quota`, {
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
  }, [isSignedIn, clerkUser, getToken]);

  // Function to refresh only quota data silently (for periodic updates during sessions)
  const fetchQuotaSilently = useCallback(async () => {
    if (!isSignedIn || !clerkUser) return;

    try {
      const token = await getToken();
      if (!token) return;

      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
      const response = await fetch(`${apiUrl}/api/usage/quota`, {
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
  }, [isSignedIn, clerkUser, getToken]);

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

  // Function to refresh user profile from Clerk
  const refetchProfile = useCallback(async () => {
    try {
      // Reload Clerk user data
      if ((window as any).Clerk?.user) {
        await (window as any).Clerk.user.reload();
      }
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