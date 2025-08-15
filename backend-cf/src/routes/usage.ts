/**
 * Usage tracking and quota management routes
 * Handles token usage reporting, quota checks, and usage history
 */

import { Hono } from 'hono';
import { Env, UsageLog } from '../types';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * Get current quota status
 */
app.get('/quota', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user quota from database
  const user = await c.env.DB.prepare(
    'SELECT id, token_quota, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Get quota from KV (more up-to-date)
  const quotaData = await c.env.QUOTA_KV.get(`quota:${userId}`);
  let quota;
  
  if (quotaData) {
    quota = JSON.parse(quotaData);
  } else {
    // Initialize quota in KV
    quota = {
      total: user.token_quota,
      used: user.tokens_used,
      remaining: user.token_quota - user.tokens_used,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    await c.env.QUOTA_KV.put(
      `quota:${userId}`,
      JSON.stringify(quota)
    );
  }
  
  return c.json(quota);
});

/**
 * Report token usage
 */
app.post('/report', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const platform = c.req.header('X-Platform');
  
  const {
    tokens,
    model,
    provider,
    sessionId,
    timestamp,
    metadata
  } = await c.req.json();
  
  // Validate input
  if (!tokens || tokens < 0) {
    return c.json({ error: 'Invalid token count' }, 400);
  }
  
  // Get user from database
  const user = await c.env.DB.prepare(
    'SELECT id, token_quota, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Check quota
  const newUsage = user.tokens_used + tokens;
  if (newUsage > user.token_quota) {
    return c.json({ 
      error: 'Quota exceeded',
      quota: {
        total: user.token_quota,
        used: user.tokens_used,
        remaining: user.token_quota - user.tokens_used,
        requested: tokens
      }
    }, 402);
  }
  
  // Record usage in database
  const logMetadata = JSON.stringify({
    sessionId,
    platform,
    timestamp: timestamp || new Date().toISOString(),
    ...metadata
  });
  
  await c.env.DB.prepare(`
    INSERT INTO usage_logs (user_id, tokens, model, provider, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    user.id,
    tokens,
    model,
    provider,
    logMetadata
  ).run();
  
  // Update user's total usage
  await c.env.DB.prepare(`
    UPDATE users 
    SET tokens_used = tokens_used + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(tokens, user.id).run();
  
  // Update quota in KV
  const updatedQuota = {
    total: user.token_quota,
    used: newUsage,
    remaining: user.token_quota - newUsage,
    resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  
  await c.env.QUOTA_KV.put(
    `quota:${userId}`,
    JSON.stringify(updatedQuota)
  );
  
  
  return c.json({
    success: true,
    quota: updatedQuota
  });
});

/**
 * Get usage history
 */
app.get('/history', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { 
    startDate, 
    endDate, 
    provider, 
    model,
    limit = 100,
    offset = 0
  } = c.req.query();
  
  // Get user ID
  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Build query
  let query = 'SELECT * FROM usage_logs WHERE user_id = ?';
  const params: any[] = [user.id];
  
  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }
  
  if (provider) {
    query += ' AND provider = ?';
    params.push(provider);
  }
  
  if (model) {
    query += ' AND model = ?';
    params.push(model);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit as string), parseInt(offset as string));
  
  // Get usage logs
  const logs = await c.env.DB.prepare(query).bind(...params).all<UsageLog>();
  
  // Get total count
  let countQuery = 'SELECT COUNT(*) as total FROM usage_logs WHERE user_id = ?';
  const countParams: any[] = [user.id];
  
  if (startDate) {
    countQuery += ' AND created_at >= ?';
    countParams.push(startDate);
  }
  
  if (endDate) {
    countQuery += ' AND created_at <= ?';
    countParams.push(endDate);
  }
  
  if (provider) {
    countQuery += ' AND provider = ?';
    countParams.push(provider);
  }
  
  if (model) {
    countQuery += ' AND model = ?';
    countParams.push(model);
  }
  
  const count = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  
  return c.json({
    logs: logs.results.map(log => ({
      id: log.id,
      tokens: log.tokens,
      model: log.model,
      provider: log.provider,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
      createdAt: log.created_at
    })),
    pagination: {
      total: count?.total || 0,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      hasMore: (count?.total || 0) > parseInt(offset as string) + parseInt(limit as string)
    }
  });
});

/**
 * Get usage statistics
 */
app.get('/stats', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { period = '30d' } = c.req.query();
  
  // Get user ID
  const user = await c.env.DB.prepare(
    'SELECT id, token_quota, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Calculate date range
  const periodDays = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90
  };
  
  const days = periodDays[period as keyof typeof periodDays] || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  
  // Get usage statistics
  const stats = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as total_requests,
      SUM(tokens) as total_tokens,
      AVG(tokens) as avg_tokens_per_request,
      MAX(tokens) as max_tokens,
      provider,
      model,
      DATE(created_at) as date
    FROM usage_logs
    WHERE user_id = ? AND created_at >= ?
    GROUP BY provider, model, DATE(created_at)
    ORDER BY date DESC
  `).bind(user.id, startDate).all();
  
  // Get session statistics
  const sessionStats = await c.env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT json_extract(metadata, '$.sessionId')) as total_sessions
    FROM usage_logs
    WHERE user_id = ? AND created_at >= ?
  `).bind(user.id, startDate).first();
  
  // Group by provider
  const byProvider: Record<string, any> = {};
  const byDate: Record<string, any> = {};
  
  stats.results.forEach(stat => {
    // Group by provider
    if (!byProvider[stat.provider]) {
      byProvider[stat.provider] = {
        totalRequests: 0,
        totalTokens: 0,
        models: {}
      };
    }
    
    byProvider[stat.provider].totalRequests += stat.total_requests;
    byProvider[stat.provider].totalTokens += stat.total_tokens;
    
    if (!byProvider[stat.provider].models[stat.model]) {
      byProvider[stat.provider].models[stat.model] = {
        requests: 0,
        tokens: 0
      };
    }
    
    byProvider[stat.provider].models[stat.model].requests += stat.total_requests;
    byProvider[stat.provider].models[stat.model].tokens += stat.total_tokens;
    
    // Group by date
    if (!byDate[stat.date]) {
      byDate[stat.date] = {
        requests: 0,
        tokens: 0
      };
    }
    
    byDate[stat.date].requests += stat.total_requests;
    byDate[stat.date].tokens += stat.total_tokens;
  });
  
  return c.json({
    period,
    quota: {
      total: user.token_quota,
      used: user.tokens_used,
      remaining: user.token_quota - user.tokens_used,
      percentageUsed: Math.round((user.tokens_used / user.token_quota) * 100)
    },
    summary: {
      totalRequests: stats.results.reduce((sum, s) => sum + s.total_requests, 0),
      totalTokens: stats.results.reduce((sum, s) => sum + s.total_tokens, 0),
      totalSessions: sessionStats?.total_sessions || 0
    },
    byProvider,
    byDate: Object.entries(byDate).map(([date, data]) => ({
      date,
      ...data
    })).sort((a, b) => b.date.localeCompare(a.date))
  });
});

/**
 * Check if quota is available for estimated usage
 */
app.post('/check', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { estimatedTokens } = await c.req.json();
  
  if (!estimatedTokens || estimatedTokens < 0) {
    return c.json({ error: 'Invalid token estimate' }, 400);
  }
  
  // Get user quota
  const user = await c.env.DB.prepare(
    'SELECT token_quota, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const remaining = user.token_quota - user.tokens_used;
  const hasQuota = remaining >= estimatedTokens;
  
  return c.json({
    hasQuota,
    quota: {
      total: user.token_quota,
      used: user.tokens_used,
      remaining,
      requested: estimatedTokens
    }
  });
});

/**
 * Reset usage (admin only)
 */
app.post('/reset', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { targetUserId } = await c.req.json();
  
  // Check if user is admin
  const ADMIN_USER_IDS = (c.env.ADMIN_USER_IDS || '').split(',');
  if (!ADMIN_USER_IDS.includes(userId)) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  
  // Reset target user's usage
  const targetUser = await c.env.DB.prepare(
    'SELECT id, clerk_id, token_quota FROM users WHERE clerk_id = ?'
  ).bind(targetUserId || userId).first();
  
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Reset in database
  await c.env.DB.prepare(
    'UPDATE users SET tokens_used = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(targetUser.id).run();
  
  // Delete old usage logs (keep last 30 days for audit)
  await c.env.DB.prepare(
    "DELETE FROM usage_logs WHERE user_id = ? AND created_at < datetime('now', '-30 days')"
  ).bind(targetUser.id).run();
  
  // Reset in KV
  await c.env.QUOTA_KV.put(
    `quota:${targetUser.clerk_id}`,
    JSON.stringify({
      total: targetUser.token_quota,
      used: 0,
      remaining: targetUser.token_quota,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  
  return c.json({
    success: true,
    message: `Usage reset for user ${targetUser.clerk_id}`
  });
});

/**
 * Sync quota across devices (HTTP polling endpoint)
 * Replaces WebSocket/Durable Objects implementation
 */
app.post('/sync', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { lastSyncTimestamp } = await c.req.json();
  
  // Get current quota from KV
  const quotaData = await c.env.QUOTA_KV.get(`quota:${userId}`);
  if (!quotaData) {
    // Get from database as fallback
    const user = await c.env.DB.prepare(
      'SELECT token_quota, tokens_used FROM users WHERE clerk_id = ?'
    ).bind(userId).first();
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    const quota = {
      total: user.token_quota,
      used: user.tokens_used,
      remaining: user.token_quota - user.tokens_used,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    // Store in KV for next time
    await c.env.QUOTA_KV.put(
      `quota:${userId}`,
      JSON.stringify(quota)
    );
    
    return c.json({
      quota,
      hasUpdates: true,
      syncTimestamp: new Date().toISOString()
    });
  }
  
  const quota = JSON.parse(quotaData);
  
  
  // Check if there are updates since last sync
  let hasUpdates = true;
  if (lastSyncTimestamp) {
    // In a more sophisticated implementation, you would track
    // the last update timestamp and compare
    // For now, we'll always return the current quota
    hasUpdates = true;
  }
  
  return c.json({
    quota,
    hasUpdates,
    syncTimestamp: new Date().toISOString()
  });
});

/**
 * Get user quota summary
 * Simplified endpoint that returns current quota status without device sessions
 */
app.get('/sessions', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user from database
  const user = await c.env.DB.prepare(
    'SELECT token_quota, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first<{ token_quota: number; tokens_used: number }>();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Get quota from KV
  const quotaData = await c.env.QUOTA_KV.get(`quota:${userId}`);
  let quota;
  
  if (quotaData) {
    quota = JSON.parse(quotaData);
  } else {
    quota = {
      total: user.token_quota,
      used: user.tokens_used,
      remaining: user.token_quota - user.tokens_used,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
  }
  
  return c.json({
    quota,
    message: 'Device session tracking has been simplified'
  });
});

export default app;