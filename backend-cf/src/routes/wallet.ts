/**
 * Wallet API routes
 * Provides endpoints for wallet balance, usage, and history
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { createWalletService } from '../services/wallet';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Get wallet status (balance, plan, frozen status)
 */
app.get('/status', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const walletService = createWalletService(c.env);
  
  try {
    // Get wallet balance and entitlements
    const balance = await walletService.getBalance('user', userId);
    
    if (!balance) {
      return c.json({ error: 'Failed to get wallet status' }, 500);
    }
    
    // Format response for frontend compatibility
    return c.json({
      // Balance information
      balance: balance.balanceTokens,
      frozen: balance.frozen,
      
      // Plan information
      plan: balance.planId?.replace(/_plan$/, '') || 'free', // Remove '_plan' suffix for display
      
      // Features and limits
      features: balance.features || [],
      rateLimitRpm: balance.rateLimitRpm || 60,
      maxConcurrentSessions: balance.maxConcurrentSessions || 1,
      
      // Compatibility fields for frontend
      total: balance.balanceTokens, // For compatibility, total = current balance
      used: 0, // In wallet model, we don't track monthly usage
      remaining: balance.frozen ? 0 : balance.balanceTokens,
      
      // No reset date in wallet model
      resetDate: null
    });
    
  } catch (error) {
    console.error('Error getting wallet status:', error);
    return c.json({ 
      error: 'Failed to get wallet status',
      details: c.env.ENVIRONMENT === 'development' ? error.message : undefined
    }, 500);
  }
});

/**
 * Use tokens from wallet
 */
app.post('/use', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const walletService = createWalletService(c.env);
  
  try {
    // Parse request body
    const body = await c.req.json();
    const { tokens, metadata } = body;
    
    // Validate input
    if (!tokens || typeof tokens !== 'number' || tokens <= 0) {
      return c.json({ error: 'Invalid token amount' }, 400);
    }
    
    // Attempt to use tokens
    const result = await walletService.useTokens({
      subjectType: 'user',
      subjectId: userId,
      tokens: tokens,
      metadata: metadata || {}
    });
    
    if (result.success) {
      return c.json({
        success: true,
        remaining: result.remaining,
        message: `Used ${tokens} tokens successfully`
      });
    } else {
      // Return appropriate error status
      if (result.error === 'Insufficient balance') {
        return c.json({
          success: false,
          error: result.error,
          remaining: result.remaining || 0
        }, 409); // Conflict - insufficient resources
      } else if (result.error === 'Wallet is frozen') {
        return c.json({
          success: false,
          error: result.error
        }, 403); // Forbidden - wallet frozen
      } else if (result.error === 'Wallet not found') {
        return c.json({
          success: false,
          error: result.error
        }, 404); // Not found
      } else {
        return c.json({
          success: false,
          error: result.error
        }, 500); // Internal error
      }
    }
    
  } catch (error) {
    console.error('Error using tokens:', error);
    return c.json({ 
      error: 'Failed to use tokens',
      details: c.env.ENVIRONMENT === 'development' ? error.message : undefined
    }, 500);
  }
});

/**
 * Get wallet history (ledger entries)
 */
app.get('/history', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const walletService = createWalletService(c.env);
  
  try {
    // Get query parameters
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');
    
    // Validate parameters
    if (limit < 1 || limit > 1000) {
      return c.json({ error: 'Limit must be between 1 and 1000' }, 400);
    }
    
    // Get history from ledger
    const history = await walletService.getHistory('user', userId, limit);
    
    // Format for frontend
    const formattedHistory = history.map(entry => ({
      id: entry.id,
      type: entry.event_type,
      amount: entry.amount_tokens,
      planId: entry.plan_id,
      metadata: entry.metadata ? JSON.parse(entry.metadata) : {},
      timestamp: entry.created_at,
      
      // Human-readable description
      description: formatHistoryDescription(entry)
    }));
    
    return c.json({
      history: formattedHistory,
      count: formattedHistory.length,
      hasMore: formattedHistory.length === limit
    });
    
  } catch (error) {
    console.error('Error getting wallet history:', error);
    return c.json({ 
      error: 'Failed to get wallet history',
      details: c.env.ENVIRONMENT === 'development' ? error.message : undefined
    }, 500);
  }
});

/**
 * Get current quota (compatibility endpoint)
 * Maps wallet status to old quota format
 */
app.get('/quota', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const walletService = createWalletService(c.env);
  
  try {
    const balance = await walletService.getBalance('user', userId);
    
    if (!balance) {
      return c.json({ error: 'Failed to get quota' }, 500);
    }
    
    // Return in old quota format for compatibility
    return c.json({
      total: balance.balanceTokens,
      used: 0, // Wallet model doesn't track monthly usage
      remaining: balance.frozen ? 0 : balance.balanceTokens,
      resetDate: null, // No reset in wallet model
      plan: balance.planId?.replace(/_plan$/, '') || 'free'
    });
    
  } catch (error) {
    console.error('Error getting quota:', error);
    return c.json({ error: 'Failed to get quota' }, 500);
  }
});

/**
 * Format history entry for human-readable description
 */
function formatHistoryDescription(entry: any): string {
  const amount = Math.abs(entry.amount_tokens);
  
  switch (entry.event_type) {
    case 'mint':
      return `Received ${amount.toLocaleString()} tokens (${entry.plan_id || 'payment'})`;
    case 'use':
      return `Used ${amount.toLocaleString()} tokens`;
    case 'refund':
      return `Refunded ${amount.toLocaleString()} tokens`;
    case 'adjust':
      return `Adjustment: ${entry.amount_tokens > 0 ? '+' : ''}${entry.amount_tokens.toLocaleString()} tokens`;
    default:
      return `${entry.event_type}: ${entry.amount_tokens.toLocaleString()} tokens`;
  }
}

export default app;