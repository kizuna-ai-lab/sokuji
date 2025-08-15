/**
 * Authentication middleware for protected routes
 */

import { Context, Next } from 'hono';
import { Env } from '../types';
import { verifyClerkToken, ensureUserExists } from '../services/clerk';

/**
 * Middleware to verify authentication token
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return c.json({ error: 'No token provided' }, 401);
  }
  
  const result = await verifyClerkToken(token, c.env);
  
  if (!result.valid || !result.userId) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  // Ensure user exists in D1 database (auto-sync from Clerk if needed)
  const userExists = await ensureUserExists(result.userId, c.env);
  if (!userExists) {
    console.error(`Failed to sync user ${result.userId} from Clerk`);
    return c.json({ error: 'User synchronization failed' }, 500);
  }
  
  // Store user info in context for use in route handlers
  c.set('userId', result.userId);
  c.set('userEmail', result.email);
  
  await next();
}

/**
 * Middleware to optionally verify authentication
 * Sets user info if valid token is present, but doesn't require it
 */
export async function optionalAuthMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (token) {
    const result = await verifyClerkToken(token, c.env);
    
    if (result.valid && result.userId) {
      // Ensure user exists in D1 database (auto-sync from Clerk if needed)
      const userExists = await ensureUserExists(result.userId, c.env);
      if (userExists) {
        c.set('userId', result.userId);
        c.set('userEmail', result.email);
      }
    }
  }
  
  await next();
}

/**
 * Middleware to check subscription status
 * Must be used after authMiddleware
 */
export async function subscriptionMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Get user subscription status from database
  const user = await c.env.DB.prepare(
    'SELECT subscription FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Check if user has active subscription
  if (user.subscription === 'free') {
    return c.json({ error: 'Subscription required' }, 402);
  }
  
  c.set('subscription', user.subscription);
  
  await next();
}

/**
 * Middleware to verify admin access
 * Must be used after authMiddleware
 */
export async function adminMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Check if user is admin (you can store this in Clerk metadata or database)
  // For now, we'll check against a list of admin user IDs
  const ADMIN_USER_IDS = (c.env.ADMIN_USER_IDS || '').split(',');
  
  if (!ADMIN_USER_IDS.includes(userId)) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  
  await next();
}