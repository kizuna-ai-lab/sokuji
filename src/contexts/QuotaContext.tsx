/**
 * Quota Management Context Provider
 * Manages token quota state and provides quota tracking methods to the application
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '../lib/clerk/ClerkProvider';
import {
  IQuotaService,
  QuotaInfo,
  UsageReport,
  QuotaWarning,
  QuotaSyncStatus
} from '../services/interfaces/IQuotaService';
import { ServiceFactory } from '../services/ServiceFactory';

interface QuotaContextValue {
  quotaInfo: QuotaInfo | null;
  syncStatus: QuotaSyncStatus;
  warning: QuotaWarning | null;
  isLoading: boolean;
  error: string | null;
  reportUsage: (usage: UsageReport) => Promise<void>;
  checkQuota: (estimatedTokens?: number) => Promise<boolean>;
  syncQuota: () => Promise<void>;
  getUsageHistory: (startDate?: Date, endDate?: Date) => Promise<UsageReport[]>;
  estimateTokens: (text: string, model?: string) => number;
  clearWarning: () => void;
  clearError: () => void;
}

const QuotaContext = createContext<QuotaContextValue | undefined>(undefined);

export function useQuota() {
  const context = useContext(QuotaContext);
  if (!context) {
    throw new Error('useQuota must be used within a QuotaProvider');
  }
  return context;
}

interface QuotaProviderProps {
  children: React.ReactNode;
}

export function QuotaProvider({ children }: QuotaProviderProps) {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);
  const [syncStatus, setSyncStatus] = useState<QuotaSyncStatus>({
    connected: false,
    lastSync: new Date(),
    pending: 0
  });
  const [warning, setWarning] = useState<QuotaWarning | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaService] = useState<IQuotaService>(() => ServiceFactory.getQuotaService());
  
  // Initialize quota service when user is authenticated
  useEffect(() => {
    const initializeQuota = async () => {
      if (!isSignedIn || !user) {
        // Clear quota info when not authenticated
        setQuotaInfo(null);
        return;
      }
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Initialize the quota service with user ID and token getter
        await quotaService.initialize(user.id, getToken);
        
        // Get initial quota info
        const quota = await quotaService.getQuotaInfo();
        setQuotaInfo(quota);
        
        // Get sync status
        const sync = quotaService.getSyncStatus();
        setSyncStatus(sync);
        
        // HTTP polling is handled by the interval below
      } catch (err: any) {
        console.error('Failed to initialize quota:', err);
        setError(err.message || 'Failed to initialize quota tracking');
      } finally {
        setIsLoading(false);
      }
    };
    
    initializeQuota();
    
    // Set up quota update listener
    const unsubscribeQuota = quotaService.onQuotaUpdate((newQuota) => {
      setQuotaInfo(newQuota);
      
      // Update sync status
      const sync = quotaService.getSyncStatus();
      setSyncStatus(sync);
    });
    
    // Set up warning listener
    const unsubscribeWarning = quotaService.onQuotaWarning((newWarning) => {
      setWarning(newWarning);
      
      // Show notification if critical or exceeded
      if (newWarning.level === 'critical' || newWarning.level === 'exceeded') {
        // You can integrate with a notification system here
        console.warn('[Quota Warning]', newWarning.message);
      }
    });
    
    // Set up sync status check interval
    const syncInterval = setInterval(() => {
      const sync = quotaService.getSyncStatus();
      setSyncStatus(sync);
    }, 5000); // Check every 5 seconds
    
    // Set up HTTP polling for quota sync (since WebSocket is removed)
    const quotaSyncInterval = setInterval(async () => {
      if (isSignedIn && user) {
        try {
          await quotaService.syncQuota();
        } catch (error) {
          // Silent failure for background sync
          console.warn('[QuotaContext] Background quota sync failed:', error);
        }
      }
    }, 60000); // Sync every 60 seconds
    
    return () => {
      unsubscribeQuota();
      unsubscribeWarning();
      clearInterval(syncInterval);
      clearInterval(quotaSyncInterval);
      
      // Cleanup handled by intervals above
    };
  }, [quotaService, user, isSignedIn, getToken]);
  
  const reportUsage = useCallback(async (usage: UsageReport) => {
    try {
      setError(null);
      await quotaService.reportUsage(usage);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to report usage';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [quotaService]);
  
  const checkQuota = useCallback(async (estimatedTokens: number = 1000): Promise<boolean> => {
    try {
      setError(null);
      return await quotaService.checkQuota(estimatedTokens);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to check quota';
      setError(errorMessage);
      return false;
    }
  }, [quotaService]);
  
  const syncQuota = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const quota = await quotaService.syncQuota();
      setQuotaInfo(quota);
      
      // Update sync status
      const sync = quotaService.getSyncStatus();
      setSyncStatus(sync);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to sync quota';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [quotaService]);
  
  const getUsageHistory = useCallback(async (startDate?: Date, endDate?: Date): Promise<UsageReport[]> => {
    try {
      setError(null);
      return await quotaService.getUsageHistory(startDate, endDate);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to get usage history';
      setError(errorMessage);
      return [];
    }
  }, [quotaService]);
  
  const estimateTokens = useCallback((text: string, model: string = 'gpt-3.5-turbo'): number => {
    return quotaService.estimateTokens(text, model);
  }, [quotaService]);
  
  const clearWarning = useCallback(() => {
    setWarning(null);
  }, []);
  
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  const value: QuotaContextValue = {
    quotaInfo,
    syncStatus,
    warning,
    isLoading,
    error,
    reportUsage,
    checkQuota,
    syncQuota,
    getUsageHistory,
    estimateTokens,
    clearWarning,
    clearError
  };
  
  return (
    <QuotaContext.Provider value={value}>
      {children}
    </QuotaContext.Provider>
  );
}