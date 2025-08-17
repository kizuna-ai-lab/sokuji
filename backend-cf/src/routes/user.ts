/**
 * User management routes
 * Handles user profile, API keys, and quota management
 */

import { Hono } from 'hono';
import { Env, User, ApiKey, HonoVariables } from '../types';
import { authMiddleware } from '../middleware/auth';
import { getClerkUser, updateClerkUserMetadata } from '../services/clerk';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Get current user profile with quota info
 */
app.get('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user from database
  const user = await c.env.DB.prepare(`
    SELECT *
    FROM users
    WHERE clerk_id = ?
  `).bind(userId).first<User>();
  
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
    quota
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








export default app;