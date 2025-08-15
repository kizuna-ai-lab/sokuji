/**
 * User Profile Context
 * Fetches and provides user profile data from the backend API,
 * including subscription information
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '../lib/clerk/ClerkProvider';

interface UserProfileData {
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
    subscription: 'free' | 'basic' | 'premium' | 'enterprise';
    createdAt: string;
    updatedAt: string;
  };
  quota: {
    total: number;
    used: number;
    remaining: number;
    resetDate?: string;
  };
  stats: {
    apiKeyCount: number;
    sessionCount: number;
  };
}

interface UserProfileContextValue {
  profile: UserProfileData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
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
  const { user } = useUser();
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!isSignedIn || !user) {
      setIsLoading(false);
      setProfile(null);
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
      const response = await fetch(`${apiUrl}/api/user/profile`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Not authenticated');
        } else if (response.status === 404) {
          throw new Error('User profile not found');
        } else {
          throw new Error(`Failed to fetch profile: ${response.statusText}`);
        }
      }
      
      const data = await response.json();
      setProfile(data);
      setError(null);
    } catch (err: any) {
      console.error('[UserProfileContext] Error fetching profile:', err);
      setError(err.message || 'Failed to fetch user profile');
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, user, getToken]);

  // Fetch profile on mount and when authentication state changes
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Re-fetch profile periodically (every 5 minutes)
  useEffect(() => {
    if (!isSignedIn) return;

    const interval = setInterval(() => {
      fetchProfile();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [isSignedIn, fetchProfile]);

  const value: UserProfileContextValue = {
    profile,
    isLoading,
    error,
    refetch: fetchProfile
  };

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
}