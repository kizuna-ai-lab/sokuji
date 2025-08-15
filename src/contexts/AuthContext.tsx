/**
 * Authentication Context Provider
 * Manages authentication state and provides auth methods to the application
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { IAuthService, AuthUser, AuthSession, SignInOptions, AuthResult } from '../services/interfaces/IAuthService';
import { ServiceFactory } from '../services/ServiceFactory';

interface AuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: (options: SignInOptions) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authService] = useState<IAuthService>(() => ServiceFactory.getAuthService());
  
  // Initialize auth service and check current auth state
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        setIsLoading(true);
        
        // Initialize the auth service
        await authService.initialize();
        
        // Check if user is already authenticated
        const currentUser = await authService.getCurrentUser();
        const currentSession = await authService.getSession();
        
        setUser(currentUser);
        setSession(currentSession);
      } catch (err) {
        console.error('Failed to initialize auth:', err);
        setError('Failed to initialize authentication');
      } finally {
        setIsLoading(false);
      }
    };
    
    initializeAuth();
    
    // Set up auth state change listener
    const unsubscribe = authService.onAuthStateChange((newUser) => {
      setUser(newUser);
      if (!newUser) {
        setSession(null);
      }
    });
    
    // Set up token refresh interval
    const refreshInterval = setInterval(async () => {
      if (session && session.expiresAt) {
        // Refresh token if it expires in less than 5 minutes
        const timeToExpiry = session.expiresAt - Date.now();
        if (timeToExpiry < 5 * 60 * 1000 && timeToExpiry > 0) {
          try {
            const newToken = await authService.refreshToken();
            if (newToken) {
              const newSession = await authService.getSession();
              setSession(newSession);
            }
          } catch (err) {
            console.error('Failed to refresh token:', err);
          }
        }
      }
    }, 60000); // Check every minute
    
    return () => {
      unsubscribe();
      clearInterval(refreshInterval);
    };
  }, [authService, session]);
  
  const signIn = useCallback(async (options: SignInOptions): Promise<AuthResult> => {
    try {
      setIsLoading(true);
      setError(null);
      
      const result = await authService.signIn(options);
      
      if (result.success) {
        setUser(result.user || null);
        setSession(result.session || null);
        
        // Sync auth state across platforms
        await authService.syncAuthState();
      } else {
        setError(result.error || 'Sign in failed');
      }
      
      return result;
    } catch (err: any) {
      const errorMessage = err.message || 'An error occurred during sign in';
      setError(errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    } finally {
      setIsLoading(false);
    }
  }, [authService]);
  
  const signOut = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      await authService.signOut();
      
      setUser(null);
      setSession(null);
      
      // Reset all service instances on logout
      ServiceFactory.resetAllInstances();
    } catch (err: any) {
      setError(err.message || 'Failed to sign out');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [authService]);
  
  const refreshToken = useCallback(async () => {
    try {
      setError(null);
      
      const newToken = await authService.refreshToken();
      if (newToken) {
        const newSession = await authService.getSession();
        setSession(newSession);
      } else {
        // Token refresh failed, user needs to sign in again
        setUser(null);
        setSession(null);
        setError('Session expired. Please sign in again.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to refresh session');
      throw err;
    }
  }, [authService]);
  
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  const value: AuthContextValue = {
    user,
    session,
    isAuthenticated: !!user && !!session && session.isValid,
    isLoading,
    error,
    signIn,
    signOut,
    refreshToken,
    clearError
  };
  
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}