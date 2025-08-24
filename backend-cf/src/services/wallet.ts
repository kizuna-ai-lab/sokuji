/**
 * Wallet Service
 * Core wallet functionality for token management
 * Implements mint-on-payment model with permanent balances
 */

import { Env } from '../types';

export interface MintRequest {
  subjectType: 'user' | 'organization';
  subjectId: string;
  planId: string;
  amountCents: number;
  externalEventId: string;
  metadata?: Record<string, any>;
}

export interface UseRequest {
  subjectType: 'user' | 'organization';
  subjectId: string;
  tokens: number;
  // API usage details
  provider?: string;
  model?: string;
  endpoint?: string;
  method?: string;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  requestId?: string;
  responseId?: string;
  eventType?: string;
  metadata?: Record<string, any>;
}

export interface WalletBalance {
  subjectType: 'user' | 'organization';
  subjectId: string;
  balanceTokens: number;
  frozen: boolean;
  planId?: string;
  features?: string[];
  rateLimitRpm?: number;
  maxConcurrentSessions?: number;
}

export class WalletService {
  constructor(private env: Env) {}

  /**
   * Mint tokens based on payment amount
   * Formula: mint = floor(Q_new * clamp(A_now / P_new, 0, 1))
   * With safety cap: max 12 months of quota per transaction
   */
  async mintTokens(request: MintRequest): Promise<{ success: boolean; minted?: number; error?: string }> {
    const { subjectType, subjectId, planId, amountCents, externalEventId, metadata } = request;

    try {
      // Check for duplicate processing (idempotency)
      const existing = await this.env.DB.prepare(
        'SELECT id FROM wallet_ledger WHERE external_event_id = ?'
      ).bind(externalEventId).first();

      if (existing) {
        console.log(`Event ${externalEventId} already processed`);
        return { success: true, minted: 0 };
      }

      // Get plan details
      const plan = await this.env.DB.prepare(
        'SELECT monthly_quota_tokens, price_cents FROM plans WHERE plan_id = ?'
      ).bind(planId).first();

      if (!plan) {
        return { success: false, error: `Plan ${planId} not found` };
      }

      const monthlyQuota = plan.monthly_quota_tokens as number;
      const priceCents = plan.price_cents as number;

      // Calculate tokens to mint
      // Safety: clamp ratio to [0, 1] and cap at 12 months
      const ratio = priceCents > 0 ? Math.min(amountCents / priceCents, 1) : 0;
      const tokensToMint = Math.min(
        Math.floor(monthlyQuota * ratio),
        monthlyQuota * 12 // Cap at 12 months worth
      );

      if (tokensToMint <= 0) {
        console.log(`No tokens to mint for amount ${amountCents} cents`);
        return { success: true, minted: 0 };
      }

      // Start transaction
      const batch = [];

      // 1. Record in ledger
      const ledgerId = crypto.randomUUID();
      batch.push(
        this.env.DB.prepare(`
          INSERT INTO wallet_ledger (
            id, subject_type, subject_id, amount_tokens, event_type,
            reference_type, reference_id, plan_id, external_event_id, 
            description, metadata
          ) VALUES (?, ?, ?, ?, 'mint', 'payment', ?, ?, ?, ?, ?)
        `).bind(
          ledgerId,
          subjectType,
          subjectId,
          tokensToMint,
          metadata?.paymentId || metadata?.paymentAttemptId || null,  // Use payment ID as reference
          planId,
          externalEventId,
          `Token mint from ${planId} payment ($${amountCents/100})`,  // Clear description
          JSON.stringify(metadata || {})
        )
      );

      // 2. Update wallet balance (UPSERT with atomic addition)
      batch.push(
        this.env.DB.prepare(`
          INSERT INTO wallets (subject_type, subject_id, balance_tokens, frozen)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(subject_type, subject_id) DO UPDATE SET
            balance_tokens = balance_tokens + ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        `).bind(subjectType, subjectId, tokensToMint, tokensToMint)
      );

      // 3. Update entitlements
      batch.push(
        this.env.DB.prepare(`
          INSERT INTO entitlements (subject_type, subject_id, plan_id)
          VALUES (?, ?, ?)
          ON CONFLICT(subject_type, subject_id) DO UPDATE SET
            plan_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        `).bind(subjectType, subjectId, planId, planId)
      );

      // Execute batch
      await this.env.DB.batch(batch);

      console.log(`Minted ${tokensToMint} tokens for ${subjectType}:${subjectId} (plan: ${planId}, paid: $${amountCents/100})`);
      return { success: true, minted: tokensToMint };

    } catch (error) {
      console.error('Error minting tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Use tokens (atomic deduction with usage logging)
   */
  async useTokens(request: UseRequest): Promise<{ success: boolean; remaining?: number; error?: string }> {
    const { 
      subjectType, subjectId, tokens, 
      provider, model, endpoint, method,
      inputTokens, outputTokens, sessionId, 
      requestId, responseId, eventType,
      metadata 
    } = request;

    if (tokens <= 0) {
      return { success: false, error: 'Invalid token amount' };
    }

    try {
      // Start transaction with batch operations
      const batch = [];
      const ledgerId = crypto.randomUUID();

      // 1. Atomic deduction with balance check
      const deductResult = await this.env.DB.prepare(`
        UPDATE wallets
        SET balance_tokens = balance_tokens - ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE subject_type = ? AND subject_id = ?
          AND frozen = 0
          AND balance_tokens >= ?
      `).bind(tokens, subjectType, subjectId, tokens).run();

      if (deductResult.meta.changes === 0) {
        // Check why it failed
        const wallet = await this.env.DB.prepare(
          'SELECT balance_tokens, frozen FROM wallets WHERE subject_type = ? AND subject_id = ?'
        ).bind(subjectType, subjectId).first();

        if (!wallet) {
          return { success: false, error: 'Wallet not found' };
        }
        if (wallet.frozen) {
          return { success: false, error: 'Wallet is frozen' };
        }
        if ((wallet.balance_tokens as number) < tokens) {
          return { success: false, error: 'Insufficient balance', remaining: wallet.balance_tokens as number };
        }
        return { success: false, error: 'Unknown error' };
      }

      // 2. Record in wallet_ledger (financial record)
      batch.push(
        this.env.DB.prepare(`
          INSERT INTO wallet_ledger (
            id, subject_type, subject_id, amount_tokens, event_type,
            reference_type, reference_id, description, metadata
          ) VALUES (?, ?, ?, ?, 'use', 'usage', ?, ?, ?)
        `).bind(
          ledgerId,
          subjectType,
          subjectId,
          -tokens,
          sessionId || requestId || null,  // Use session or request as reference
          `${provider || 'unknown'}/${model || 'unknown'} API usage`,
          JSON.stringify({
            provider,
            model,
            endpoint,
            method,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            ...metadata
          })
        )
      );

      // 3. Record in usage_logs (detailed API usage)
      if (provider && model) {
        batch.push(
          this.env.DB.prepare(`
            INSERT INTO usage_logs (
              subject_type, subject_id,
              provider, model, endpoint, method,
              input_tokens, output_tokens, total_tokens,
              session_id, request_id, response_id, event_type,
              ledger_id, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            subjectType,
            subjectId,
            provider,
            model,
            endpoint || null,
            method || null,
            inputTokens || 0,
            outputTokens || 0,
            tokens,
            sessionId || null,
            requestId || null,
            responseId || null,
            eventType || null,
            ledgerId,
            JSON.stringify(metadata || {})
          )
        );
      }

      // Execute batch operations
      if (batch.length > 0) {
        await this.env.DB.batch(batch);
      }

      // Get remaining balance
      const wallet = await this.env.DB.prepare(
        'SELECT balance_tokens FROM wallets WHERE subject_type = ? AND subject_id = ?'
      ).bind(subjectType, subjectId).first();

      return { success: true, remaining: wallet?.balance_tokens as number };

    } catch (error) {
      console.error('Error using tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refund tokens (negative mint)
   */
  async refundTokens(
    subjectType: 'user' | 'organization',
    subjectId: string,
    tokens: number,
    externalEventId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check for duplicate
      const existing = await this.env.DB.prepare(
        'SELECT id FROM wallet_ledger WHERE external_event_id = ?'
      ).bind(externalEventId).first();

      if (existing) {
        return { success: true };
      }

      const batch = [];

      // Record refund in ledger
      batch.push(
        this.env.DB.prepare(`
          INSERT INTO wallet_ledger (
            subject_type, subject_id, amount_tokens, event_type, 
            reference_type, reference_id, external_event_id, description
          ) VALUES (?, ?, ?, 'refund', 'refund', ?, ?, ?)
        `).bind(
          subjectType, 
          subjectId, 
          -tokens, 
          externalEventId,  // Use as reference_id for refunds
          externalEventId,
          `Token refund - ${tokens} tokens deducted`
        )
      );

      // Deduct from wallet (may go negative, which triggers freeze)
      batch.push(
        this.env.DB.prepare(`
          UPDATE wallets
          SET balance_tokens = balance_tokens - ?,
              frozen = CASE WHEN balance_tokens - ? < 0 THEN 1 ELSE frozen END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE subject_type = ? AND subject_id = ?
        `).bind(tokens, tokens, subjectType, subjectId)
      );

      await this.env.DB.batch(batch);
      return { success: true };

    } catch (error) {
      console.error('Error refunding tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get wallet balance and entitlements
   */
  async getBalance(
    subjectType: 'user' | 'organization',
    subjectId: string
  ): Promise<WalletBalance | null> {
    try {
      const result = await this.env.DB.prepare(`
        SELECT 
          w.subject_type,
          w.subject_id,
          w.balance_tokens,
          w.frozen,
          e.plan_id,
          e.features,
          e.rate_limit_rpm,
          e.max_concurrent_sessions
        FROM wallets w
        LEFT JOIN entitlements e 
          ON w.subject_type = e.subject_type 
          AND w.subject_id = e.subject_id
        WHERE w.subject_type = ? AND w.subject_id = ?
      `).bind(subjectType, subjectId).first();

      if (!result) {
        // Return default for new users
        return {
          subjectType,
          subjectId,
          balanceTokens: 0,
          frozen: false,
          planId: 'free_plan',
          rateLimitRpm: 60,
          maxConcurrentSessions: 1
        };
      }

      return {
        subjectType: result.subject_type as 'user' | 'organization',
        subjectId: result.subject_id as string,
        balanceTokens: result.balance_tokens as number,
        frozen: result.frozen === 1,
        planId: result.plan_id as string,
        features: result.features ? JSON.parse(result.features as string) : [],
        rateLimitRpm: result.rate_limit_rpm as number || 60,
        maxConcurrentSessions: result.max_concurrent_sessions as number || 1
      };

    } catch (error) {
      console.error('Error getting balance:', error);
      return null;
    }
  }

  /**
   * Set wallet frozen status
   */
  async setFrozenStatus(
    subjectType: 'user' | 'organization',
    subjectId: string,
    frozen: boolean
  ): Promise<boolean> {
    try {
      await this.env.DB.prepare(`
        UPDATE wallets
        SET frozen = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE subject_type = ? AND subject_id = ?
      `).bind(frozen ? 1 : 0, subjectType, subjectId).run();

      return true;
    } catch (error) {
      console.error('Error setting frozen status:', error);
      return false;
    }
  }

  /**
   * Update entitlements (plan features)
   */
  async updateEntitlements(
    subjectType: 'user' | 'organization',
    subjectId: string,
    planId: string
  ): Promise<boolean> {
    try {
      // Get plan features (you can customize these per plan)
      const features = this.getPlanFeatures(planId);
      
      await this.env.DB.prepare(`
        INSERT INTO entitlements (
          subject_type, subject_id, plan_id, 
          features, rate_limit_rpm, max_concurrent_sessions
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(subject_type, subject_id) DO UPDATE SET
          plan_id = ?,
          features = ?,
          rate_limit_rpm = ?,
          max_concurrent_sessions = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      `).bind(
        subjectType, subjectId, planId,
        JSON.stringify(features.features), features.rateLimitRpm, features.maxConcurrentSessions,
        planId, JSON.stringify(features.features), features.rateLimitRpm, features.maxConcurrentSessions
      ).run();

      return true;
    } catch (error) {
      console.error('Error updating entitlements:', error);
      return false;
    }
  }

  /**
   * Get plan features (customize as needed)
   */
  private getPlanFeatures(planId: string): {
    features: string[];
    rateLimitRpm: number;
    maxConcurrentSessions: number;
  } {
    const planFeatures: Record<string, any> = {
      'free_plan': {
        features: ['basic'],
        rateLimitRpm: 60,
        maxConcurrentSessions: 1
      },
      'starter_plan': {
        features: ['basic', 'priority_support'],
        rateLimitRpm: 120,
        maxConcurrentSessions: 2
      },
      'essentials_plan': {
        features: ['basic', 'priority_support', 'advanced_models'],
        rateLimitRpm: 180,
        maxConcurrentSessions: 3
      },
      'pro_plan': {
        features: ['basic', 'priority_support', 'advanced_models', 'api_access'],
        rateLimitRpm: 300,
        maxConcurrentSessions: 5
      },
      'business_plan': {
        features: ['basic', 'priority_support', 'advanced_models', 'api_access', 'team_features'],
        rateLimitRpm: 600,
        maxConcurrentSessions: 10
      },
      'enterprise_plan': {
        features: ['all'],
        rateLimitRpm: 1200,
        maxConcurrentSessions: 50
      },
      'unlimited_plan': {
        features: ['all'],
        rateLimitRpm: 9999,
        maxConcurrentSessions: 100
      }
    };

    return planFeatures[planId] || planFeatures['free_plan'];
  }

  /**
   * Get usage statistics including 30-day rolling usage
   */
  async getUsageStats(
    subjectType: 'user' | 'organization',
    subjectId: string
  ): Promise<{ last30DaysUsage: number; monthlyQuota: number } | null> {
    try {
      // Get 30-day rolling usage (sum of all 'use' events)
      const usageResult = await this.env.DB.prepare(`
        SELECT 
          COALESCE(ABS(SUM(amount_tokens)), 0) as usage
        FROM wallet_ledger
        WHERE subject_type = ? 
          AND subject_id = ?
          AND event_type = 'use'
          AND created_at >= datetime('now', '-30 days')
      `).bind(subjectType, subjectId).first();

      // Get monthly quota from plan
      const planResult = await this.env.DB.prepare(`
        SELECT 
          p.monthly_quota_tokens
        FROM entitlements e
        JOIN plans p ON e.plan_id = p.plan_id
        WHERE e.subject_type = ? AND e.subject_id = ?
      `).bind(subjectType, subjectId).first();

      // If no entitlement found, check for free plan
      const monthlyQuota = planResult?.monthly_quota_tokens || 0;

      return {
        last30DaysUsage: usageResult?.usage as number || 0,
        monthlyQuota: monthlyQuota as number
      };
    } catch (error) {
      console.error('Error getting usage stats:', error);
      return null;
    }
  }

  /**
   * Get usage history from ledger
   */
  async getHistory(
    subjectType: 'user' | 'organization',
    subjectId: string,
    limit: number = 100
  ): Promise<any[]> {
    try {
      const rows = await this.env.DB.prepare(`
        SELECT 
          id,
          amount_tokens,
          event_type,
          plan_id,
          metadata,
          created_at
        FROM wallet_ledger
        WHERE subject_type = ? AND subject_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(subjectType, subjectId, limit).all();

      return rows.results || [];
    } catch (error) {
      console.error('Error getting history:', error);
      return [];
    }
  }
}

// Export singleton factory
export function createWalletService(env: Env): WalletService {
  return new WalletService(env);
}