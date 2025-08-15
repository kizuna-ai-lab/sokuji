/**
 * User management routes
 * Handles user profile, API keys, and quota management
 */

import { Hono } from 'hono';
import { Env, User, ApiKey } from '../types';
import { authMiddleware } from '../middleware/auth';
import { getClerkUser, updateClerkUserMetadata } from '../services/clerk';

const app = new Hono<{ Bindings: Env }>();

/**
 * Get current user profile with quota info
 */
app.get('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user from database
  const user = await c.env.DB.prepare(`
    SELECT u.*, 
           COUNT(DISTINCT s.id) as session_count
    FROM users u
    LEFT JOIN sessions s ON u.id = s.user_id
    WHERE u.clerk_id = ?
    GROUP BY u.id
  `).bind(userId).first<User & { session_count: number }>();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Get quota info from KV
  const quotaData = await c.env.QUOTA_KV.get(`quota:${userId}`);
  const quota = quotaData ? JSON.parse(quotaData) : {
    total: user.token_quota,
    used: user.tokens_used,
    remaining: user.token_quota - user.tokens_used,
    resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  
  return c.json({
    user: {
      id: user.clerk_id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      imageUrl: user.image_url,
      subscription: user.subscription,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    },
    quota,
    stats: {
      sessionCount: user.session_count
    }
  });
});

/**
 * Update user profile
 */
app.patch('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { firstName, lastName } = await c.req.json();
  
  // Update in database
  await c.env.DB.prepare(`
    UPDATE users 
    SET first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(firstName, lastName, userId).run();
  
  // Update in Clerk
  await updateClerkUserMetadata(userId, {
    firstName,
    lastName
  }, c.env);
  
  return c.json({ success: true });
});

/**
 * Get user's single API key for Kizuna AI
 * Temporary implementation - returns hardcoded API key
 */
app.get('/api-key', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Return hardcoded API key for testing
  // In production, this would fetch/generate actual API keys
  return c.json({
    apiKey: 'sk-proj-Your-api-key-here',
    provider: 'kizunaai',
    createdAt: new Date().toISOString()
  });
});


/**
 * Get user's sessions
 */
app.get('/sessions', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user ID
  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Get sessions
  const sessions = await c.env.DB.prepare(`
    SELECT device_id, platform, last_active, metadata
    FROM sessions
    WHERE user_id = ?
    ORDER BY last_active DESC
  `).bind(user.id).all();
  
  return c.json({
    sessions: sessions.results.map(session => ({
      deviceId: session.device_id,
      platform: session.platform,
      lastActive: session.last_active,
      metadata: session.metadata ? JSON.parse(session.metadata as string) : null
    }))
  });
});

/**
 * Delete a session
 */
app.delete('/sessions/:deviceId', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const deviceId = c.req.param('deviceId');
  
  // Get user ID
  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Delete session
  await c.env.DB.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND device_id = ?'
  ).bind(user.id, deviceId).run();
  
  // Clear from KV
  await c.env.SESSION_KV.delete(`session:${userId}:${deviceId}`);
  
  return c.json({ success: true });
});

/**
 * Helper function to generate API key
 */
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'sk-';
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}


/**
 * Helper function to get rate limit based on subscription
 */
function getRateLimit(subscription: string): number {
  const limits: Record<string, number> = {
    free: 10,      // 10 requests per minute
    basic: 60,     // 60 requests per minute
    premium: 300,  // 300 requests per minute
    enterprise: -1 // unlimited
  };
  return limits[subscription] || 10;
}

/**
 * Helper function to get provider key from pool
 * In production, this would manage a pool of provider API keys
 */
async function getProviderKeyFromPool(provider: string, env: Env): Promise<string | null> {
  // For now, return the configured key for the provider
  // In production, you'd have a pool of keys to distribute
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY;
    case 'kizunaai':
      return env.KIZUNA_AI_API_KEY || env.OPENAI_API_KEY; // Fallback to OpenAI key if not configured
    default:
      return null;
  }
}

export default app;