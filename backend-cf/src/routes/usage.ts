/**
 * Usage tracking and quota management routes
 * Handles token usage reporting, quota checks, and usage history
 */

import { Hono } from 'hono';
import { Env, UsageLog, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Get current quota status
 * Calculates usage from usage_logs table in real-time
 */
app.get('/quota', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user quota and subscription from database
  const user = await c.env.DB.prepare(
    'SELECT id, token_quota, subscription FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Calculate current month's usage from usage_logs table
  const currentMonth = new Date().toISOString().slice(0, 7) + '-01'; // First day of current month
  
  const usageResult = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(total_tokens), 0) as used
    FROM usage_logs 
    WHERE user_id = ? AND created_at >= ?
  `).bind(user.id, currentMonth).first();
  
  const tokensUsed = (usageResult?.used as number) || 0;
  // Remove '_plan' suffix from subscription for frontend display
  const plan = (user.subscription as string || 'free').replace(/_plan$/, '');
  const quota = {
    total: user.token_quota,
    used: tokensUsed,
    remaining: user.token_quota === -1 ? -1 : Math.max(0, (user.token_quota as number) - tokensUsed),
    resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    plan: plan  // Return plan without '_plan' suffix
  };
  
  return c.json(quota);
});








export default app;