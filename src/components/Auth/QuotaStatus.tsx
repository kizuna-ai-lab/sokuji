/**
 * Quota status component that displays real-time token usage
 */

import React from 'react';
import { useQuota } from '../../contexts/QuotaContext';
import { AlertCircle, TrendingUp } from 'lucide-react';
import './QuotaStatus.scss';

interface QuotaStatusProps {
  compact?: boolean;
  showWarning?: boolean;
}

export function QuotaStatus({ compact = false, showWarning = true }: QuotaStatusProps) {
  const { quotaInfo, warning, isLoading, error } = useQuota();

  if (isLoading) {
    return (
      <div className="quota-status quota-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="quota-status quota-error">
        <AlertCircle size={14} />
        <span>Unable to load quota</span>
      </div>
    );
  }

  if (!quotaInfo) {
    return null;
  }

  const usagePercentage = quotaInfo.total > 0 
    ? (quotaInfo.used / quotaInfo.total) * 100 
    : 0;
  
  const remainingTokens = quotaInfo.remaining;
  const isUnlimited = quotaInfo.total === -1;

  if (compact) {
    return (
      <div className="quota-status-compact">
        <div className="quota-bar">
          <div 
            className="quota-progress" 
            style={{ width: isUnlimited ? '0%' : `${usagePercentage}%` }}
          />
        </div>
        <span className="quota-text">
          {isUnlimited ? (
            'Unlimited tokens'
          ) : (
            `${(remainingTokens / 1000000).toFixed(1)}M tokens left`
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="quota-status">
      {showWarning && warning && (
        <div className={`quota-warning warning-${warning.level}`}>
          <AlertCircle size={14} />
          <span>{warning.message}</span>
        </div>
      )}

      <div className="quota-header">
        <h4>Token Usage</h4>
        {quotaInfo.resetDate && (
          <span className="reset-date">
            Resets {new Date(quotaInfo.resetDate).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="quota-details">
        <div className="quota-bar-container">
          <div className="quota-bar">
            <div 
              className={`quota-progress ${usagePercentage > 80 ? 'high-usage' : ''}`}
              style={{ width: isUnlimited ? '0%' : `${usagePercentage}%` }}
            />
          </div>
          <div className="quota-labels">
            <span className="usage-label">
              {isUnlimited ? (
                <>
                  <TrendingUp size={12} />
                  {(quotaInfo.used / 1000000).toFixed(2)}M used
                </>
              ) : (
                <>
                  {(quotaInfo.used / 1000000).toFixed(2)}M / {(quotaInfo.total / 1000000).toFixed(0)}M
                </>
              )}
            </span>
            {!isUnlimited && (
              <span className="remaining-label">
                {(remainingTokens / 1000000).toFixed(2)}M remaining
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}