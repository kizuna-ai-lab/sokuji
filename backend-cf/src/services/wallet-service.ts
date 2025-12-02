/**
 * Wallet Service for backend-cf
 * Simplified wallet functionality focused on token top-up
 * Conversion rate: 1 USD = 1,000,000 tokens (1M tokens)
 */

import type { CloudflareBindings } from "../env";

// Constants
const TOKENS_PER_DOLLAR = 1_000_000;
const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = "wallet:";

export interface TopUpRequest {
    subjectType: "user" | "organization";
    subjectId: string;
    amountCents: number;
    externalEventId: string;
    stripePaymentIntentId?: string;
    stripeSessionId?: string;
    metadata?: Record<string, any>;
}

export interface WalletBalance {
    subjectType: "user" | "organization";
    subjectId: string;
    balanceTokens: number;
    frozen: boolean;
}

export class WalletService {
    constructor(private env: CloudflareBindings) {}

    /**
     * Get wallet balance (with KV caching)
     */
    async getBalance(
        subjectType: "user" | "organization",
        subjectId: string,
        skipCache: boolean = false
    ): Promise<WalletBalance | null> {
        const cacheKey = `${CACHE_PREFIX}${subjectType}:${subjectId}`;

        // Try cache first
        if (!skipCache && this.env.KV) {
            try {
                const cached = await this.env.KV.get(cacheKey, "json");
                if (cached) {
                    return cached as WalletBalance;
                }
            } catch (error) {
                console.warn("Cache read error:", error);
            }
        }

        try {
            const result = await this.env.DATABASE.prepare(`
                SELECT subject_type, subject_id, balance_tokens, frozen
                FROM wallets
                WHERE subject_type = ? AND subject_id = ?
            `)
                .bind(subjectType, subjectId)
                .first();

            if (!result) {
                // Return default for new users
                return {
                    subjectType,
                    subjectId,
                    balanceTokens: 0,
                    frozen: false,
                };
            }

            const walletBalance: WalletBalance = {
                subjectType: result.subject_type as "user" | "organization",
                subjectId: result.subject_id as string,
                balanceTokens: result.balance_tokens as number,
                frozen: result.frozen === 1,
            };

            // Cache the result
            if (this.env.KV) {
                try {
                    await this.env.KV.put(cacheKey, JSON.stringify(walletBalance), {
                        expirationTtl: CACHE_TTL,
                    });
                } catch (error) {
                    console.warn("Cache write error:", error);
                }
            }

            return walletBalance;
        } catch (error) {
            console.error("Error getting balance:", error);
            return null;
        }
    }

    /**
     * Update cache with latest balance
     */
    private async updateCache(
        subjectType: "user" | "organization",
        subjectId: string,
        walletBalance: WalletBalance
    ): Promise<void> {
        if (!this.env.KV) return;

        const cacheKey = `${CACHE_PREFIX}${subjectType}:${subjectId}`;
        try {
            await this.env.KV.put(cacheKey, JSON.stringify(walletBalance), {
                expirationTtl: CACHE_TTL,
            });
        } catch (error) {
            console.warn("Cache update error:", error);
        }
    }

    /**
     * Mint tokens from top-up payment
     * Formula: 1 USD = 1,000,000 tokens (1M tokens)
     */
    async mintTokensFromTopUp(
        request: TopUpRequest
    ): Promise<{ success: boolean; minted?: number; error?: string }> {
        const {
            subjectType,
            subjectId,
            amountCents,
            externalEventId,
            stripePaymentIntentId,
            stripeSessionId,
            metadata,
        } = request;

        try {
            // Check for duplicate processing (idempotency)
            const existing = await this.env.DATABASE.prepare(
                "SELECT id FROM wallet_ledger WHERE external_event_id = ?"
            )
                .bind(externalEventId)
                .first();

            if (existing) {
                console.log(`TopUp event ${externalEventId} already processed`);
                return { success: true, minted: 0 };
            }

            // Calculate tokens: $1 = 1M tokens
            const tokensToMint = Math.floor((amountCents / 100) * TOKENS_PER_DOLLAR);

            if (tokensToMint <= 0) {
                console.log(`No tokens to mint for amount ${amountCents} cents`);
                return { success: true, minted: 0 };
            }

            // Execute transaction
            const batch = [];

            // 1. Record in ledger
            const ledgerId = crypto.randomUUID();
            batch.push(
                this.env.DATABASE.prepare(`
                    INSERT INTO wallet_ledger (
                        id, subject_type, subject_id, amount_tokens, event_type,
                        reference_type, reference_id, external_event_id,
                        description, metadata, created_at
                    ) VALUES (?, ?, ?, ?, 'mint', 'topup', ?, ?, ?, ?, ?)
                `).bind(
                    ledgerId,
                    subjectType,
                    subjectId,
                    tokensToMint,
                    stripePaymentIntentId || stripeSessionId || null,
                    externalEventId,
                    `Token top-up ($${(amountCents / 100).toFixed(2)})`,
                    JSON.stringify({
                        amountCents,
                        amountUsd: amountCents / 100,
                        tokensPerDollar: TOKENS_PER_DOLLAR,
                        stripePaymentIntentId,
                        stripeSessionId,
                        ...metadata,
                    }),
                    Date.now()
                )
            );

            // 2. Update wallet balance (UPSERT)
            batch.push(
                this.env.DATABASE.prepare(`
                    INSERT INTO wallets (subject_type, subject_id, balance_tokens, frozen, updated_at)
                    VALUES (?, ?, ?, 0, ?)
                    ON CONFLICT(subject_type, subject_id) DO UPDATE SET
                        balance_tokens = balance_tokens + ?,
                        updated_at = ?
                `).bind(
                    subjectType,
                    subjectId,
                    tokensToMint,
                    Date.now(),
                    tokensToMint,
                    Date.now()
                )
            );

            // Execute batch
            await this.env.DATABASE.batch(batch);

            // Update cache
            const updatedWallet = await this.getBalance(subjectType, subjectId, true);
            if (updatedWallet) {
                await this.updateCache(subjectType, subjectId, updatedWallet);
            }

            console.log(
                `TopUp: Minted ${tokensToMint} tokens for ${subjectType}:${subjectId} (paid: $${amountCents / 100})`
            );
            return { success: true, minted: tokensToMint };
        } catch (error) {
            console.error("Error minting tokens from top-up:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Get usage statistics (30-day rolling usage)
     */
    async getUsageStats(
        subjectType: "user" | "organization",
        subjectId: string
    ): Promise<{ last30DaysUsage: number } | null> {
        try {
            const usageResult = await this.env.DATABASE.prepare(`
                SELECT
                    COALESCE(ABS(SUM(amount_tokens)), 0) as usage
                FROM wallet_ledger
                WHERE subject_type = ?
                    AND subject_id = ?
                    AND event_type = 'use'
                    AND created_at >= ?
            `)
                .bind(subjectType, subjectId, Date.now() - 30 * 24 * 60 * 60 * 1000)
                .first();

            return {
                last30DaysUsage: (usageResult?.usage as number) || 0,
            };
        } catch (error) {
            console.error("Error getting usage stats:", error);
            return null;
        }
    }

    /**
     * Get payment history (top-up transactions)
     */
    async getPaymentHistory(
        subjectType: "user" | "organization",
        subjectId: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<{ payments: any[]; total: number }> {
        try {
            const payments = await this.env.DATABASE.prepare(`
                SELECT
                    id,
                    amount_tokens,
                    event_type,
                    reference_type,
                    reference_id,
                    description,
                    metadata,
                    created_at
                FROM wallet_ledger
                WHERE subject_type = ?
                    AND subject_id = ?
                    AND event_type = 'mint'
                    AND reference_type = 'topup'
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `)
                .bind(subjectType, subjectId, limit, offset)
                .all();

            const countResult = await this.env.DATABASE.prepare(`
                SELECT COUNT(*) as total
                FROM wallet_ledger
                WHERE subject_type = ?
                    AND subject_id = ?
                    AND event_type = 'mint'
                    AND reference_type = 'topup'
            `)
                .bind(subjectType, subjectId)
                .first();

            return {
                payments: payments.results || [],
                total: (countResult?.total as number) || 0,
            };
        } catch (error) {
            console.error("Error getting payment history:", error);
            return { payments: [], total: 0 };
        }
    }
}

export function createWalletService(env: CloudflareBindings): WalletService {
    return new WalletService(env);
}
