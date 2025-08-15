/**
 * Quota Management Service Interface
 * Handles token quota tracking, usage reporting, and cross-platform synchronization
 */

export interface QuotaInfo {
  userId: string;
  total: number;          // Total token quota
  used: number;           // Tokens used
  remaining: number;      // Tokens remaining
  resetDate: Date;        // When quota resets
  lastUpdated: Date;      // Last sync time
}

export interface UsageReport {
  tokens: number;
  model: string;
  provider: 'openai' | 'gemini' | 'comet' | 'palabra';
  timestamp: Date;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface QuotaWarning {
  level: 'low' | 'critical' | 'exceeded';
  remaining: number;
  percentage: number;
  message: string;
}

export interface QuotaSyncStatus {
  connected: boolean;
  lastSync: Date;
  pending: number;  // Pending reports to sync
}

export interface IQuotaService {
  /**
   * Initialize the quota service
   */
  initialize(userId: string, getToken?: () => Promise<string | null>): Promise<void>;
  
  /**
   * Get current quota information
   */
  getQuotaInfo(): Promise<QuotaInfo>;
  
  /**
   * Check if user has enough quota for a request
   */
  checkQuota(estimatedTokens?: number): Promise<boolean>;
  
  /**
   * Report token usage
   */
  reportUsage(usage: UsageReport): Promise<void>;
  
  /**
   * Batch report multiple usage records
   */
  batchReportUsage(usages: UsageReport[]): Promise<void>;
  
  /**
   * Get usage history
   */
  getUsageHistory(startDate?: Date, endDate?: Date): Promise<UsageReport[]>;
  
  /**
   * Sync quota with backend
   */
  syncQuota(): Promise<QuotaInfo>;
  
  /**
   * Get cross-platform unified quota status
   */
  getUnifiedQuotaStatus(): Promise<QuotaInfo>;
  
  
  /**
   * Get sync status
   */
  getSyncStatus(): QuotaSyncStatus;
  
  /**
   * Set quota warning threshold (percentage)
   */
  setWarningThreshold(percentage: number): void;
  
  /**
   * Listen for quota warnings
   */
  onQuotaWarning(callback: (warning: QuotaWarning) => void): () => void;
  
  /**
   * Listen for quota updates
   */
  onQuotaUpdate(callback: (quota: QuotaInfo) => void): () => void;
  
  /**
   * Reset local quota cache
   */
  resetCache(): Promise<void>;
  
  /**
   * Get estimated tokens for text
   */
  estimateTokens(text: string, model?: string): number;
}