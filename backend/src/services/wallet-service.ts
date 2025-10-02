/**
 * Wallet Service
 * Core wallet functionality for token management
 * Implements mint-on-payment model with permanent balances
 * Includes integrated pricing calculations for billing
 */

import type { CloudflareBindings } from "../env";
import { TokenUsageBuffer, BufferedUsage } from './token-usage-buffer';

// Type alias for compatibility with backend-cf
type Env = CloudflareBindings;

// ============================================
// PRICING CONFIGURATION
// ============================================

/**
 * Profit margin multiplier (1.2 = 20% profit margin)
 * Adjust this value to change the overall profit margin
 */
const PROFIT_MARGIN = 1.2;

/**
 * Our base price per 1M tokens in USD
 * This is what we charge customers
 */
const OUR_PRICE_PER_1M = 10.0;

/**
 * Provider costs per 1M tokens in USD
 * Based on official pricing from OpenAI
 */
const PROVIDER_COSTS = {
  'openai': {
    'gpt-4o-realtime-preview-2024-10-01': {
      'text': { input: 5.0, output: 20.0 },
      'audio': { input: 40.0, output: 80.0 }
    },
    'gpt-4o-realtime-preview': {
      'text': { input: 5.0, output: 20.0 },
      'audio': { input: 40.0, output: 80.0 }
    },
    'gpt-4o-mini-realtime-preview-2024-10-01': {
      'text': { input: 0.6, output: 2.4 },
      'audio': { input: 10.0, output: 20.0 }
    },
    'gpt-4o-mini-realtime-preview': {
      'text': { input: 0.6, output: 2.4 },
      'audio': { input: 10.0, output: 20.0 }
    }
  }
} as const;

/**
 * Time-based costs for providers (per minute)
 * Used for duration-based billing (e.g., Whisper transcription)
 */
const TIME_BASED_COSTS = {
  'whisper': 0.006,  // $0.006/minute for transcription
  'transcription': 0.006  // Generic transcription cost
} as const;

type Modality = 'text' | 'audio' | 'transcription';

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
  // API usage details
  provider?: string;
  model?: string;
  endpoint?: string;
  method?: string;
  // Raw token counts (for token-based billing)
  inputTokens?: number;
  outputTokens?: number;
  // Duration in seconds (for time-based billing like transcription)
  durationSeconds?: number;
  // Modality type (optional - can be auto-detected)
  modality?: Modality;
  // Session details
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

interface ModelPricingRatios {
  inputRatio: number;
  outputRatio: number;
}

export class WalletService {
  private ratios: Record<string, Record<string, Record<Modality, ModelPricingRatios>>>;
  private static readonly CACHE_TTL = 300; // 5 minutes in seconds
  private static readonly CACHE_PREFIX = 'wallet:';
  private usageBuffer?: TokenUsageBuffer;
  
  constructor(private env: Env, private enableBatching: boolean = false) {
    // Calculate ratios based on provider costs and profit margin
    this.ratios = this.calculateRatios();
    console.log('WalletService initialized with integrated pricing, profit margin:', PROFIT_MARGIN);
    
    // Initialize usage buffer if batching is enabled
    if (enableBatching) {
      this.usageBuffer = new TokenUsageBuffer(env);
      console.log('Token usage batching enabled');
    }
  }
  
  /**
   * Update cache with latest balance data
   * This ensures cache consistency after database updates
   */
  private async updateCache(
    subjectType: 'user' | 'organization',
    subjectId: string,
    walletBalance: WalletBalance
  ): Promise<void> {
    if (!this.env.KV) return;
    
    const cacheKey = `${WalletService.CACHE_PREFIX}${subjectType}:${subjectId}`;
    try {
      await this.env.KV.put(
        cacheKey,
        JSON.stringify(walletBalance),
        { expirationTtl: WalletService.CACHE_TTL }
      );
      console.log(`Updated cache for ${subjectType}:${subjectId} with balance: ${walletBalance.balanceTokens}`);
    } catch (error) {
      console.warn('Error updating cache:', error);
      // Don't fail the operation if cache update fails
    }
  }
  
  /**
   * Invalidate cache for a specific wallet
   * Used when external processes update the database
   */
  async invalidateCache(
    subjectType: 'user' | 'organization',
    subjectId: string
  ): Promise<void> {
    if (!this.env.KV) return;
    
    const cacheKey = `${WalletService.CACHE_PREFIX}${subjectType}:${subjectId}`;
    try {
      await this.env.KV.delete(cacheKey);
      console.log(`Invalidated cache for ${subjectType}:${subjectId}`);
    } catch (error) {
      console.warn('Error invalidating cache:', error);
    }
  }
  
  /**
   * Atomically update wallet balance and return the new balance
   * This ensures consistency between database and cache
   */
  private async updateBalance(
    subjectType: 'user' | 'organization',
    subjectId: string,
    delta: number
  ): Promise<{ success: boolean; newBalance?: number; frozen?: boolean; error?: string }> {
    try {
      // First, update the balance
      const updateResult = await this.env.DATABASE.prepare(`
        UPDATE wallets
        SET balance_tokens = balance_tokens + ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE subject_type = ? AND subject_id = ?
          AND frozen = 0
      `).bind(delta, subjectType, subjectId).run();
      
      if (updateResult.meta.changes === 0) {
        // Check why it failed
        const wallet = await this.env.DATABASE.prepare(
          'SELECT balance_tokens, frozen FROM wallets WHERE subject_type = ? AND subject_id = ?'
        ).bind(subjectType, subjectId).first();
        
        if (!wallet) {
          return { success: false, error: 'Wallet not found' };
        }
        if (wallet.frozen) {
          return { success: false, error: 'Wallet is frozen', frozen: true };
        }
        return { success: false, error: 'Unknown error' };
      }
      
      // Then, get the updated balance (since SQLite doesn't support RETURNING in UPDATE)
      const updatedWallet = await this.env.DATABASE.prepare(`
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
      
      if (!updatedWallet) {
        return { success: false, error: 'Failed to retrieve updated balance' };
      }
      
      // Update cache with the latest balance
      const walletBalance: WalletBalance = {
        subjectType: updatedWallet.subject_type as 'user' | 'organization',
        subjectId: updatedWallet.subject_id as string,
        balanceTokens: updatedWallet.balance_tokens as number,
        frozen: updatedWallet.frozen === 1,
        planId: updatedWallet.plan_id as string,
        features: updatedWallet.features ? JSON.parse(updatedWallet.features as string) : [],
        rateLimitRpm: updatedWallet.rate_limit_rpm as number || 60,
        maxConcurrentSessions: updatedWallet.max_concurrent_sessions as number || 1
      };
      
      await this.updateCache(subjectType, subjectId, walletBalance);
      
      return { 
        success: true, 
        newBalance: updatedWallet.balance_tokens as number,
        frozen: updatedWallet.frozen === 1
      };
      
    } catch (error) {
      console.error('Error updating balance:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Calculate pricing ratios for all models
   * Formula: (provider_cost / our_price) * profit_margin
   */
  private calculateRatios(): Record<string, Record<string, Record<Modality, ModelPricingRatios>>> {
    const ratios: any = {};
    
    for (const [provider, models] of Object.entries(PROVIDER_COSTS)) {
      ratios[provider] = {};
      for (const [model, modalities] of Object.entries(models)) {
        ratios[provider][model] = {};
        for (const [modality, costs] of Object.entries(modalities)) {
          const inputRatio = (costs.input / OUR_PRICE_PER_1M) * PROFIT_MARGIN;
          const outputRatio = (costs.output / OUR_PRICE_PER_1M) * PROFIT_MARGIN;
          
          ratios[provider][model][modality] = {
            inputRatio,
            outputRatio
          };
          
          console.log(`Pricing ratio for ${provider}/${model}/${modality}:`, {
            inputRatio: inputRatio.toFixed(3),
            outputRatio: outputRatio.toFixed(3)
          });
        }
      }
    }
    
    return ratios;
  }
  
  /**
   * Convert duration (seconds) to tokens for time-based billing
   * Used for Whisper transcription and similar services
   */
  private convertDurationToTokens(seconds: number): number {
    // Whisper: $0.006/minute = $0.0001/second
    // Our price: $10/1M tokens
    // Base conversion: 1 second = (0.0001 / 10) * 1,000,000 = 10 tokens
    // With profit margin: 10 * 1.2 = 12 tokens/second
    const tokensPerSecond = Math.ceil((TIME_BASED_COSTS.whisper / 60) / OUR_PRICE_PER_1M * 1000000 * PROFIT_MARGIN);
    return Math.ceil(seconds * tokensPerSecond);
  }
  
  /**
   * Determine modality type based on model name and other factors
   */
  private determineModality(model: string, endpoint?: string, eventType?: string): Modality {
    // Check if it's a transcription event
    if (eventType === 'conversation.item.input_audio_transcription.completed') {
      return 'transcription';
    }
    
    // If it's a realtime model, determine based on endpoint and event type
    if (model.includes('realtime')) {
      // REST API endpoints typically use text
      if (endpoint && (endpoint.includes('/chat/completions') || endpoint.includes('/completions'))) {
        return 'text';
      }
      // WebSocket events are typically audio for realtime models
      return 'audio';
    }
    
    // Non-realtime models are text
    return 'text';
  }
  
  /**
   * Calculate adjusted token amounts based on provider, model, and modality
   */
  private calculateAdjustedTokens(
    provider: string,
    model: string,
    modality: Modality,
    inputTokens: number,
    outputTokens: number
  ): {
    adjustedInputTokens: number;
    adjustedOutputTokens: number;
    totalAdjustedTokens: number;
    inputRatio: number;
    outputRatio: number;
  } {
    // Get pricing ratios for this model
    let modelRatios = this.ratios[provider]?.[model]?.[modality];
    
    // Try fallback patterns for OpenAI models if exact match not found
    if (!modelRatios && provider === 'openai') {
      let fallbackModel: string | null = null;
      
      // Check for gpt-4o-mini variants first (more specific)
      if (model.includes('gpt-4o-mini')) {
        fallbackModel = 'gpt-4o-mini-realtime-preview';
      } 
      // Then check for gpt-4o variants (less specific)
      else if (model.includes('gpt-4o')) {
        fallbackModel = 'gpt-4o-realtime-preview';
      }
      
      if (fallbackModel) {
        modelRatios = this.ratios[provider]?.[fallbackModel]?.[modality];
        if (modelRatios) {
          console.log(`Using fallback pricing for ${provider}/${model}/${modality} -> ${fallbackModel}`);
        }
      }
    }
    
    if (!modelRatios) {
      // Unknown model or provider - use conservative 1:1 ratio
      console.warn(`No pricing configuration found for ${provider}/${model}/${modality}, using 1:1 ratio`);
      return {
        adjustedInputTokens: inputTokens,
        adjustedOutputTokens: outputTokens,
        totalAdjustedTokens: inputTokens + outputTokens,
        inputRatio: 1,
        outputRatio: 1
      };
    }
    
    // Calculate adjusted tokens (round up to ensure no losses)
    const adjustedInputTokens = Math.ceil(inputTokens * modelRatios.inputRatio);
    const adjustedOutputTokens = Math.ceil(outputTokens * modelRatios.outputRatio);
    const totalAdjustedTokens = adjustedInputTokens + adjustedOutputTokens;
    
    console.log('Token adjustment calculation:', {
      provider,
      model,
      modality,
      rawInput: inputTokens,
      rawOutput: outputTokens,
      adjustedInput: adjustedInputTokens,
      adjustedOutput: adjustedOutputTokens,
      totalAdjusted: totalAdjustedTokens,
      inputRatio: modelRatios.inputRatio.toFixed(3),
      outputRatio: modelRatios.outputRatio.toFixed(3)
    });
    
    return {
      adjustedInputTokens,
      adjustedOutputTokens,
      totalAdjustedTokens,
      inputRatio: modelRatios.inputRatio,
      outputRatio: modelRatios.outputRatio
    };
  }

  /**
   * Mint tokens based on payment amount
   * Formula: mint = floor(Q_new * clamp(A_now / P_new, 0, 1))
   * With safety cap: max 12 months of quota per transaction
   */
  async mintTokens(request: MintRequest): Promise<{ success: boolean; minted?: number; error?: string }> {
    const { subjectType, subjectId, planId, amountCents, externalEventId, metadata } = request;

    try {
      // Check for duplicate processing (idempotency)
      const existing = await this.env.DATABASE.prepare(
        'SELECT id FROM wallet_ledger WHERE external_event_id = ?'
      ).bind(externalEventId).first();

      if (existing) {
        console.log(`Event ${externalEventId} already processed`);
        return { success: true, minted: 0 };
      }

      // Get plan details
      const plan = await this.env.DATABASE.prepare(
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
        this.env.DATABASE.prepare(`
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
        this.env.DATABASE.prepare(`
          INSERT INTO wallets (subject_type, subject_id, balance_tokens, frozen)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(subject_type, subject_id) DO UPDATE SET
            balance_tokens = balance_tokens + ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        `).bind(subjectType, subjectId, tokensToMint, tokensToMint)
      );

      // 3. Update entitlements
      batch.push(
        this.env.DATABASE.prepare(`
          INSERT INTO entitlements (subject_type, subject_id, plan_id)
          VALUES (?, ?, ?)
          ON CONFLICT(subject_type, subject_id) DO UPDATE SET
            plan_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        `).bind(subjectType, subjectId, planId, planId)
      );

      // Execute batch
      await this.env.DATABASE.batch(batch);

      // Get the updated wallet balance and update cache
      const updatedWallet = await this.getBalance(subjectType, subjectId, true); // Skip cache, get fresh from DB
      if (updatedWallet) {
        await this.updateCache(subjectType, subjectId, updatedWallet);
      }

      console.log(`Minted ${tokensToMint} tokens for ${subjectType}:${subjectId} (plan: ${planId}, paid: $${amountCents/100})`);
      return { success: true, minted: tokensToMint };

    } catch (error) {
      console.error('Error minting tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Use tokens (atomic deduction with usage logging and automatic pricing calculation)
   * Allows negative balance - will deduct tokens unconditionally
   * Supports both token-based and duration-based billing
   * Can batch usage logs if batching is enabled
   * Ensures cache consistency by updating cache with latest balance
   */
  async useTokens(request: UseRequest & { batchLogging?: boolean }): Promise<{ success: boolean; remaining?: number; deducted?: number; error?: string }> {
    const { 
      subjectType, subjectId,
      provider, model, endpoint, method,
      inputTokens = 0, outputTokens = 0,
      durationSeconds,
      modality,
      sessionId, requestId, responseId, eventType,
      metadata 
    } = request;

    let tokens = 0;
    let actualInputTokens = inputTokens;
    let actualOutputTokens = outputTokens;
    let adjustment: {
      adjustedInputTokens: number;
      adjustedOutputTokens: number;
      totalAdjustedTokens: number;
      inputRatio: number;
      outputRatio: number;
    };
    
    // Determine modality first
    const actualModality = modality || this.determineModality(model || '', endpoint, eventType);
    
    // Handle duration-based billing (e.g., transcription)
    if (durationSeconds !== undefined && durationSeconds > 0) {
      // Convert duration to tokens
      tokens = this.convertDurationToTokens(durationSeconds);
      actualInputTokens = tokens; // Consider duration as input tokens
      actualOutputTokens = 0;
      
      // Create adjustment object for duration-based billing
      adjustment = {
        adjustedInputTokens: tokens,
        adjustedOutputTokens: 0,
        totalAdjustedTokens: tokens,
        inputRatio: 1.2, // Our profit margin for transcription
        outputRatio: 0
      };
      
      console.log('Duration-based billing:', {
        durationSeconds,
        calculatedTokens: tokens,
        eventType,
        model
      });
    } else {
      // Handle token-based billing
      // Validate input - allow zero tokens for some events
      if (inputTokens < 0 || outputTokens < 0) {
        return { success: false, error: 'Invalid negative token values' };
      }
      
      // If both are zero, this might be a no-cost event, allow it
      if (inputTokens === 0 && outputTokens === 0) {
        console.log('Zero-token event, proceeding without deduction:', { eventType, model });
        // Get current balance for return value
        const wallet = await this.env.DATABASE.prepare(
          'SELECT balance_tokens FROM wallets WHERE subject_type = ? AND subject_id = ?'
        ).bind(subjectType, subjectId).first();
        
        return { success: true, remaining: wallet?.balance_tokens as number || 0, deducted: 0 };
      }
      
      // Calculate adjusted tokens internally
      adjustment = this.calculateAdjustedTokens(
        provider || 'openai',
        model || 'unknown',
        actualModality,
        actualInputTokens,
        actualOutputTokens
      );
      
      tokens = adjustment.totalAdjustedTokens;
    }

    try {
      // 1. First, atomically update the balance (critical path)
      const balanceResult = await this.updateBalance(subjectType, subjectId, -tokens);
      
      if (!balanceResult.success) {
        return { 
          success: false, 
          error: balanceResult.error,
          remaining: balanceResult.newBalance
        };
      }
      
      // Start batch operations for ledger and usage logs
      const batch = [];
      const ledgerId = crypto.randomUUID();

      // 2. Record in wallet_ledger (financial record)
      batch.push(
        this.env.DATABASE.prepare(`
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
        // Check if we should batch the usage log
        const shouldBatch = (request.batchLogging !== false) && this.usageBuffer && this.enableBatching;
        
        if (shouldBatch) {
          // Add to buffer for batch processing
          await this.usageBuffer!.add({
            subjectType,
            subjectId,
            provider,
            model,
            endpoint: endpoint || undefined,
            method: method || undefined,
            inputTokens,
            outputTokens,
            adjustedInputTokens: adjustment.adjustedInputTokens,
            adjustedOutputTokens: adjustment.adjustedOutputTokens,
            adjustedTotalTokens: adjustment.totalAdjustedTokens,
            inputRatio: adjustment.inputRatio,
            outputRatio: adjustment.outputRatio,
            modality: actualModality,
            sessionId: sessionId || undefined,
            requestId: requestId || undefined,
            responseId: responseId || undefined,
            eventType: eventType || undefined,
            metadata: {
              ...metadata,
              duration_seconds: durationSeconds || null,
              adjusted_tokens: {
                input: adjustment.adjustedInputTokens,
                output: adjustment.adjustedOutputTokens,
                total: adjustment.totalAdjustedTokens
              },
              pricing_ratios: {
                input: adjustment.inputRatio,
                output: adjustment.outputRatio
              }
            },
            timestamp: new Date().toISOString(),
            ledgerId
          });
        } else {
          // Immediate write to database
          batch.push(
            this.env.DATABASE.prepare(`
              INSERT INTO usage_logs (
                subject_type, subject_id,
                provider, model, endpoint, method,
                input_tokens, output_tokens, total_tokens,
                adjusted_input_tokens, adjusted_output_tokens, adjusted_total_tokens,
                input_ratio, output_ratio, modality,
                session_id, request_id, response_id, event_type,
                ledger_id, metadata
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              subjectType,
              subjectId,
              provider,
              model,
              endpoint || null,
              method || null,
              inputTokens,
              outputTokens,
              inputTokens + outputTokens,  // Raw total tokens
              adjustment.adjustedInputTokens,
              adjustment.adjustedOutputTokens,
              adjustment.totalAdjustedTokens,
              adjustment.inputRatio,
              adjustment.outputRatio,
              actualModality,
              sessionId || null,
              requestId || null,
              responseId || null,
              eventType || null,
              ledgerId,
              JSON.stringify({
                ...metadata,
                duration_seconds: durationSeconds || null,
                adjusted_tokens: {
                  input: adjustment.adjustedInputTokens,
                  output: adjustment.adjustedOutputTokens,
                  total: adjustment.totalAdjustedTokens
                },
                pricing_ratios: {
                  input: adjustment.inputRatio,
                  output: adjustment.outputRatio
                }
              })
            )
          );
        }
      }

      // Execute batch operations for ledger
      if (batch.length > 0) {
        await this.env.DATABASE.batch(batch);
      }

      // Cache is already updated in updateBalance method
      return { 
        success: true, 
        remaining: balanceResult.newBalance!, 
        deducted: tokens 
      };

    } catch (error) {
      console.error('Error using tokens:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
      const existing = await this.env.DATABASE.prepare(
        'SELECT id FROM wallet_ledger WHERE external_event_id = ?'
      ).bind(externalEventId).first();

      if (existing) {
        return { success: true };
      }

      const batch = [];

      // Record refund in ledger
      batch.push(
        this.env.DATABASE.prepare(`
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
        this.env.DATABASE.prepare(`
          UPDATE wallets
          SET balance_tokens = balance_tokens - ?,
              frozen = CASE WHEN balance_tokens - ? < 0 THEN 1 ELSE frozen END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE subject_type = ? AND subject_id = ?
        `).bind(tokens, tokens, subjectType, subjectId)
      );

      await this.env.DATABASE.batch(batch);
      
      // Get the updated wallet balance and update cache
      const updatedWallet = await this.getBalance(subjectType, subjectId, true); // Skip cache, get fresh from DB
      if (updatedWallet) {
        await this.updateCache(subjectType, subjectId, updatedWallet);
      }
      
      return { success: true };

    } catch (error) {
      console.error('Error refunding tokens:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get wallet balance and entitlements (with caching)
   */
  async getBalance(
    subjectType: 'user' | 'organization',
    subjectId: string,
    skipCache: boolean = false
  ): Promise<WalletBalance | null> {
    const cacheKey = `${WalletService.CACHE_PREFIX}${subjectType}:${subjectId}`;
    
    // Try to get from cache first (unless skipCache is true)
    if (!skipCache && this.env.KV) {
      try {
        const cached = await this.env.KV.get(cacheKey, 'json');
        if (cached) {
          console.log(`Cache hit for wallet ${subjectType}:${subjectId}`);
          return cached as WalletBalance;
        }
      } catch (error) {
        console.warn('Error reading from cache:', error);
        // Continue to database query if cache fails
      }
    }
    
    try {
      const result = await this.env.DATABASE.prepare(`
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

      const walletBalance: WalletBalance = {
        subjectType: result.subject_type as 'user' | 'organization',
        subjectId: result.subject_id as string,
        balanceTokens: result.balance_tokens as number,
        frozen: result.frozen === 1,
        planId: result.plan_id as string,
        features: result.features ? JSON.parse(result.features as string) : [],
        rateLimitRpm: result.rate_limit_rpm as number || 60,
        maxConcurrentSessions: result.max_concurrent_sessions as number || 1
      };
      
      // Cache the result
      if (this.env.KV) {
        try {
          await this.env.KV.put(
            cacheKey, 
            JSON.stringify(walletBalance),
            { expirationTtl: WalletService.CACHE_TTL }
          );
        } catch (error) {
          console.warn('Error writing to cache:', error);
          // Don't fail the operation if cache write fails
        }
      }
      
      return walletBalance;

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
      await this.env.DATABASE.prepare(`
        UPDATE wallets
        SET frozen = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE subject_type = ? AND subject_id = ?
      `).bind(frozen ? 1 : 0, subjectType, subjectId).run();

      // Get the updated wallet balance and update cache
      const updatedWallet = await this.getBalance(subjectType, subjectId, true); // Skip cache, get fresh from DB
      if (updatedWallet) {
        await this.updateCache(subjectType, subjectId, updatedWallet);
      }

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
      
      await this.env.DATABASE.prepare(`
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
      const usageResult = await this.env.DATABASE.prepare(`
        SELECT 
          COALESCE(ABS(SUM(amount_tokens)), 0) as usage
        FROM wallet_ledger
        WHERE subject_type = ? 
          AND subject_id = ?
          AND event_type = 'use'
          AND created_at >= datetime('now', '-30 days')
      `).bind(subjectType, subjectId).first();

      // Get monthly quota from plan
      const planResult = await this.env.DATABASE.prepare(`
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
      const rows = await this.env.DATABASE.prepare(`
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

  /**
   * Get or create wallet - optimized method that combines existence check with balance retrieval
   * This reduces the number of queries by doing everything in one operation
   */
  async getOrCreateWallet(
    subjectType: 'user' | 'organization',
    subjectId: string,
    planId: string = 'free_plan'
  ): Promise<WalletBalance | null> {
    // First, try to get the wallet (which includes caching)
    let walletBalance = await this.getBalance(subjectType, subjectId);
    
    // If wallet exists, return it
    if (walletBalance && walletBalance.balanceTokens !== undefined) {
      return walletBalance;
    }
    
    // Wallet doesn't exist, create it
    try {
      console.log(`Creating new wallet for ${subjectType}:${subjectId} with plan ${planId}`);
      
      // Get plan details
      const plan = await this.env.DATABASE.prepare(
        'SELECT monthly_quota_tokens FROM plans WHERE plan_id = ?'
      ).bind(planId).first();
      
      const initialTokens = (plan?.monthly_quota_tokens as number) || 0;
      
      // Start transaction
      const batch = [];
      
      // 1. Create wallet with initial balance
      batch.push(
        this.env.DATABASE.prepare(`
          INSERT OR IGNORE INTO wallets (subject_type, subject_id, balance_tokens, frozen)
          VALUES (?, ?, ?, 0)
        `).bind(subjectType, subjectId, initialTokens)
      );
      
      // 2. Create entitlements
      const features = this.getPlanFeatures(planId);
      batch.push(
        this.env.DATABASE.prepare(`
          INSERT OR IGNORE INTO entitlements (
            subject_type, subject_id, plan_id,
            features, rate_limit_rpm, max_concurrent_sessions
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          subjectType, subjectId, planId,
          JSON.stringify(features.features),
          features.rateLimitRpm,
          features.maxConcurrentSessions
        )
      );
      
      // 3. If there are initial tokens, record in ledger
      if (initialTokens && initialTokens > 0) {
        const ledgerId = crypto.randomUUID();
        batch.push(
          this.env.DATABASE.prepare(`
            INSERT INTO wallet_ledger (
              id, subject_type, subject_id, amount_tokens, event_type,
              reference_type, reference_id, plan_id, description
            ) VALUES (?, ?, ?, ?, 'mint', 'registration', ?, ?, ?)
          `).bind(
            ledgerId,
            subjectType,
            subjectId,
            initialTokens,
            'initial_registration',
            planId,
            `Initial ${planId} token allocation`
          )
        );
      }
      
      // Execute batch
      await this.env.DATABASE.batch(batch);
      
      console.log(`Successfully created wallet for ${subjectType}:${subjectId} with ${initialTokens} initial tokens`);
      
      // Now get the wallet balance (skip cache since we just created it)
      walletBalance = await this.getBalance(subjectType, subjectId, true);
      
      // Update cache with the newly created wallet
      if (walletBalance) {
        await this.updateCache(subjectType, subjectId, walletBalance);
      }
      
      return walletBalance;
      
    } catch (error) {
      console.error('Error creating wallet:', error);
      // Try to get balance again in case it was created by another process
      return await this.getBalance(subjectType, subjectId, true);
    }
  }
  
  /**
   * Ensure wallet exists for a user - creates if missing
   * This is used for self-healing when a wallet is expected but not found
   * @deprecated Use getOrCreateWallet instead for better performance
   */
  async ensureWalletExists(
    subjectType: 'user' | 'organization',
    subjectId: string,
    planId: string = 'free_plan'
  ): Promise<boolean> {
    try {
      // Check if wallet already exists
      const existing = await this.env.DATABASE.prepare(
        'SELECT subject_id FROM wallets WHERE subject_type = ? AND subject_id = ?'
      ).bind(subjectType, subjectId).first();
      
      if (existing) {
        console.log(`Wallet already exists for ${subjectType}:${subjectId}`);
        return true;
      }
      
      console.log(`Creating new wallet for ${subjectType}:${subjectId} with plan ${planId}`);
      
      // Get plan details
      const plan = await this.env.DATABASE.prepare(
        'SELECT monthly_quota_tokens FROM plans WHERE plan_id = ?'
      ).bind(planId).first();
      
      const initialTokens = (plan?.monthly_quota_tokens as number) || 0;
      
      // Start transaction
      const batch = [];
      
      // 1. Create wallet with initial balance
      batch.push(
        this.env.DATABASE.prepare(`
          INSERT OR IGNORE INTO wallets (subject_type, subject_id, balance_tokens, frozen)
          VALUES (?, ?, ?, 0)
        `).bind(subjectType, subjectId, initialTokens)
      );
      
      // 2. Create entitlements
      batch.push(
        this.env.DATABASE.prepare(`
          INSERT OR IGNORE INTO entitlements (subject_type, subject_id, plan_id)
          VALUES (?, ?, ?)
        `).bind(subjectType, subjectId, planId)
      );
      
      // 3. If there are initial tokens, record in ledger
      if (initialTokens && initialTokens > 0) {
        const ledgerId = crypto.randomUUID();
        batch.push(
          this.env.DATABASE.prepare(`
            INSERT INTO wallet_ledger (
              id, subject_type, subject_id, amount_tokens, event_type,
              reference_type, reference_id, plan_id, description
            ) VALUES (?, ?, ?, ?, 'mint', 'registration', ?, ?, ?)
          `).bind(
            ledgerId,
            subjectType,
            subjectId,
            initialTokens,
            'initial_registration',
            planId,
            `Initial ${planId} token allocation`
          )
        );
      }
      
      // Execute batch
      await this.env.DATABASE.batch(batch);
      
      console.log(`Successfully created wallet for ${subjectType}:${subjectId} with ${initialTokens} initial tokens`);
      return true;
      
    } catch (error) {
      console.error('Error ensuring wallet exists:', error);
      // Check if wallet was created by another process
      const wallet = await this.env.DATABASE.prepare(
        'SELECT subject_id FROM wallets WHERE subject_type = ? AND subject_id = ?'
      ).bind(subjectType, subjectId).first();
      
      return !!wallet;
    }
  }
  
  /**
   * Flush any buffered usage logs to the database
   */
  async flushUsageBuffer(): Promise<void> {
    if (this.usageBuffer) {
      await this.usageBuffer.flush();
    }
  }
  
  /**
   * Close the wallet service and flush any remaining buffers
   */
  async close(): Promise<void> {
    if (this.usageBuffer) {
      await this.usageBuffer.close();
      this.usageBuffer = undefined;
    }
  }
}

// Export singleton factory
export function createWalletService(env: Env, enableBatching: boolean = false): WalletService {
  return new WalletService(env, enableBatching);
}