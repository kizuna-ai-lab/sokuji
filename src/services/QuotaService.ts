/**
 * Unified Quota Management Service
 * Handles token quota tracking with HTTP polling synchronization
 * Works in both Electron and Browser Extension environments
 */

import {
  IQuotaService,
  QuotaInfo,
  UsageReport,
  QuotaWarning,
  DeviceUsage,
  QuotaSyncStatus
} from './interfaces/IQuotaService';

export class QuotaService implements IQuotaService {
  private userId: string | null = null;
  private quotaInfo: QuotaInfo | null = null;
  private warningThreshold: number = 20; // Default 20% warning
  private quotaUpdateListeners: ((quota: QuotaInfo) => void)[] = [];
  private quotaWarningListeners: ((warning: QuotaWarning) => void)[] = [];
  private syncStatus: QuotaSyncStatus = {
    connected: false,
    lastSync: new Date(),
    pending: 0,
    devices: []
  };
  private pendingReports: UsageReport[] = [];
  private backendUrl: string = import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
  private deviceId: string | null = null;
  private getTokenFn: (() => Promise<string | null>) | null = null;
  
  async initialize(userId: string, getToken?: () => Promise<string | null>): Promise<void> {
    this.userId = userId;
    this.deviceId = await this.getDeviceId();
    this.getTokenFn = getToken || null;
    
    // Load cached quota info
    const cached = await this.getCachedQuotaInfo();
    if (cached) {
      this.quotaInfo = cached;
      this.notifyQuotaUpdate(cached);
    }
    
    // Sync with backend
    await this.syncQuota();
    
    // Flush any pending reports
    await this.flushPendingReports();
  }
  
  async getQuotaInfo(): Promise<QuotaInfo> {
    if (!this.quotaInfo) {
      await this.syncQuota();
    }
    
    if (!this.quotaInfo) {
      throw new Error('Failed to get quota information');
    }
    
    return this.quotaInfo;
  }
  
  async checkQuota(estimatedTokens: number = 1000): Promise<boolean> {
    const quota = await this.getQuotaInfo();
    return quota.remaining >= estimatedTokens;
  }
  
  async reportUsage(usage: UsageReport): Promise<void> {
    if (!this.userId) {
      throw new Error('Service not initialized');
    }
    
    // Update local quota immediately for responsive UI
    if (this.quotaInfo) {
      this.quotaInfo.used += usage.tokens;
      this.quotaInfo.remaining = Math.max(0, this.quotaInfo.remaining - usage.tokens);
      this.quotaInfo.lastUpdated = new Date();
      
      await this.cacheQuotaInfo(this.quotaInfo);
      this.notifyQuotaUpdate(this.quotaInfo);
      this.checkAndNotifyWarnings();
    }
    
    // Report to backend
    await this.reportUsageHTTP(usage);
  }
  
  async batchReportUsage(usages: UsageReport[]): Promise<void> {
    for (const usage of usages) {
      await this.reportUsage(usage);
    }
  }
  
  async getUsageHistory(startDate?: Date, endDate?: Date): Promise<UsageReport[]> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());
    if (this.deviceId) params.append('deviceId', this.deviceId);
    
    const response = await fetch(`${this.backendUrl}/api/usage/history?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to get usage history');
    }
    
    const data = await response.json();
    return data.logs.map((log: any) => ({
      tokens: log.tokens,
      model: log.model,
      provider: log.provider,
      timestamp: new Date(log.createdAt),
      sessionId: log.metadata?.sessionId,
      metadata: log.metadata
    }));
  }
  
  async syncQuota(): Promise<QuotaInfo> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    const platform = this.getPlatform();
    
    const response = await fetch(`${this.backendUrl}/api/usage/quota`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Device-Id': this.deviceId || '',
        'X-Platform': platform
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to sync quota');
    }
    
    const data = await response.json();
    
    this.quotaInfo = {
      userId: this.userId!,
      total: data.total,
      used: data.used,
      remaining: data.remaining,
      resetDate: new Date(data.resetDate),
      lastUpdated: new Date()
    };
    
    this.syncStatus.lastSync = new Date();
    this.syncStatus.connected = true;
    
    await this.cacheQuotaInfo(this.quotaInfo);
    this.notifyQuotaUpdate(this.quotaInfo);
    this.checkAndNotifyWarnings();
    
    // Flush pending reports after sync
    await this.flushPendingReports();
    
    return this.quotaInfo;
  }
  
  async getUnifiedQuotaStatus(): Promise<QuotaInfo & { devices: DeviceUsage[] }> {
    const quota = await this.getQuotaInfo();
    return {
      ...quota,
      devices: this.syncStatus.devices
    };
  }
  
  
  getSyncStatus(): QuotaSyncStatus {
    return { ...this.syncStatus };
  }
  
  setWarningThreshold(percentage: number): void {
    this.warningThreshold = Math.max(0, Math.min(100, percentage));
  }
  
  onQuotaWarning(callback: (warning: QuotaWarning) => void): () => void {
    this.quotaWarningListeners.push(callback);
    
    // Check current status
    this.checkAndNotifyWarnings();
    
    return () => {
      const index = this.quotaWarningListeners.indexOf(callback);
      if (index > -1) {
        this.quotaWarningListeners.splice(index, 1);
      }
    };
  }
  
  onQuotaUpdate(callback: (quota: QuotaInfo) => void): () => void {
    this.quotaUpdateListeners.push(callback);
    
    // Call with current quota if available
    if (this.quotaInfo) {
      callback(this.quotaInfo);
    }
    
    return () => {
      const index = this.quotaUpdateListeners.indexOf(callback);
      if (index > -1) {
        this.quotaUpdateListeners.splice(index, 1);
      }
    };
  }
  
  async resetCache(): Promise<void> {
    localStorage.removeItem('quotaInfo');
    localStorage.removeItem('pendingReports');
    
    this.quotaInfo = null;
    this.pendingReports = [];
    this.syncStatus.pending = 0;
  }
  
  estimateTokens(text: string, model: string = 'gpt-3.5-turbo'): number {
    // Simple estimation: ~4 characters per token for English text
    // This is a rough approximation; actual tokenization varies by model
    const baseEstimate = Math.ceil(text.length / 4);
    
    // Adjust for different models
    const modelMultipliers: Record<string, number> = {
      'gpt-4': 1.1,
      'gpt-3.5-turbo': 1.0,
      'claude': 1.2,
      'gemini': 0.9
    };
    
    const multiplier = modelMultipliers[model] || 1.0;
    return Math.ceil(baseEstimate * multiplier);
  }
  
  // Private helper methods
  
  private async reportUsageHTTP(usage: UsageReport): Promise<void> {
    const token = await this.getAuthToken();
    if (!token) {
      // Queue for later
      this.pendingReports.push(usage);
      this.syncStatus.pending = this.pendingReports.length;
      await this.cachePendingReports(this.pendingReports);
      return;
    }
    
    const platform = this.getPlatform();
    
    try {
      const response = await fetch(`${this.backendUrl}/api/usage/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Device-Id': this.deviceId || '',
          'X-Platform': platform
        },
        body: JSON.stringify({
          tokens: usage.tokens,
          model: usage.model,
          provider: usage.provider,
          sessionId: usage.sessionId,
          timestamp: usage.timestamp.toISOString(),
          metadata: usage.metadata
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.quota) {
          this.quotaInfo = {
            userId: this.userId!,
            total: data.quota.total,
            used: data.quota.used,
            remaining: data.quota.remaining,
            resetDate: new Date(data.quota.resetDate),
            lastUpdated: new Date()
          };
          
          await this.cacheQuotaInfo(this.quotaInfo);
          this.notifyQuotaUpdate(this.quotaInfo);
          this.checkAndNotifyWarnings();
        }
      } else if (response.status === 402) {
        // Quota exceeded
        const data = await response.json();
        this.notifyQuotaWarning({
          level: 'exceeded',
          remaining: 0,
          percentage: 100,
          message: data.error || 'Quota exceeded'
        });
      }
    } catch (error) {
      console.error('[QuotaService] Failed to report usage:', error);
      // Queue for later
      this.pendingReports.push(usage);
      this.syncStatus.pending = this.pendingReports.length;
      await this.cachePendingReports(this.pendingReports);
    }
  }
  
  private async flushPendingReports(): Promise<void> {
    // Load any cached pending reports
    const cached = await this.getCachedPendingReports();
    if (cached && cached.length > 0) {
      this.pendingReports = [...cached, ...this.pendingReports];
    }
    
    if (this.pendingReports.length === 0) {
      return;
    }
    
    const reports = [...this.pendingReports];
    this.pendingReports = [];
    this.syncStatus.pending = 0;
    
    // Clear cache
    await this.cachePendingReports([]);
    
    for (const report of reports) {
      await this.reportUsage(report);
    }
  }
  
  private checkAndNotifyWarnings(): void {
    if (!this.quotaInfo) {
      return;
    }
    
    const percentageUsed = (this.quotaInfo.used / this.quotaInfo.total) * 100;
    const percentageRemaining = 100 - percentageUsed;
    
    if (this.quotaInfo.remaining <= 0) {
      this.notifyQuotaWarning({
        level: 'exceeded',
        remaining: 0,
        percentage: 100,
        message: 'Token quota exceeded. Please upgrade your subscription.'
      });
    } else if (percentageRemaining <= 5) {
      this.notifyQuotaWarning({
        level: 'critical',
        remaining: this.quotaInfo.remaining,
        percentage: percentageUsed,
        message: `Critical: Only ${this.quotaInfo.remaining.toLocaleString()} tokens remaining`
      });
    } else if (percentageRemaining <= this.warningThreshold) {
      this.notifyQuotaWarning({
        level: 'low',
        remaining: this.quotaInfo.remaining,
        percentage: percentageUsed,
        message: `Warning: ${percentageRemaining.toFixed(1)}% of quota remaining`
      });
    }
  }
  
  private notifyQuotaUpdate(quota: QuotaInfo): void {
    this.quotaUpdateListeners.forEach(listener => listener(quota));
  }
  
  private notifyQuotaWarning(warning: QuotaWarning): void {
    this.quotaWarningListeners.forEach(listener => listener(warning));
  }
  
  private async getCachedQuotaInfo(): Promise<QuotaInfo | null> {
    try {
      const cached = localStorage.getItem('quotaInfo');
      if (cached) {
        const quotaInfo = JSON.parse(cached);
        // Convert date strings back to Date objects
        quotaInfo.resetDate = new Date(quotaInfo.resetDate);
        quotaInfo.lastUpdated = new Date(quotaInfo.lastUpdated);
        return quotaInfo;
      }
    } catch (error) {
      console.error('Failed to get cached quota info:', error);
    }
    return null;
  }
  
  private async cacheQuotaInfo(quota: QuotaInfo): Promise<void> {
    try {
      localStorage.setItem('quotaInfo', JSON.stringify(quota));
    } catch (error) {
      console.error('Failed to cache quota info:', error);
    }
  }
  
  private async getCachedPendingReports(): Promise<UsageReport[]> {
    try {
      const cached = localStorage.getItem('pendingReports');
      if (cached) {
        const reports = JSON.parse(cached);
        // Convert date strings back to Date objects
        return reports.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp)
        }));
      }
    } catch (error) {
      console.error('Failed to get cached pending reports:', error);
    }
    return [];
  }
  
  private async cachePendingReports(reports: UsageReport[]): Promise<void> {
    try {
      if (reports.length === 0) {
        localStorage.removeItem('pendingReports');
      } else {
        localStorage.setItem('pendingReports', JSON.stringify(reports));
      }
    } catch (error) {
      console.error('Failed to cache pending reports:', error);
    }
  }
  
  private async getAuthToken(): Promise<string | null> {
    // If a getToken function was provided during initialization, use it
    if (this.getTokenFn) {
      try {
        return await this.getTokenFn();
      } catch (error) {
        console.error('Failed to get auth token:', error);
        return null;
      }
    }
    
    // Fallback: try to get from localStorage (for backward compatibility)
    try {
      const authSession = localStorage.getItem('authSession');
      if (authSession) {
        const session = JSON.parse(authSession);
        return session.token || null;
      }
    } catch (error) {
      console.error('Failed to get auth token from storage:', error);
    }
    
    return null;
  }
  
  private async getDeviceId(): Promise<string> {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
  }
  
  private getPlatform(): string {
    // Check for Electron
    if (navigator.userAgent.includes('Electron')) {
      return 'electron';
    }
    
    // Check for Chrome extension
    if (typeof window !== 'undefined' && 
        (window as any).chrome && 
        (window as any).chrome.runtime && 
        (window as any).chrome.runtime.id) {
      return 'extension';
    }
    
    // Default to web
    return 'web';
  }
}