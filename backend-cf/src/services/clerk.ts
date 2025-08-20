/**
 * Clerk authentication service
 * Handles JWT verification and user management with Clerk
 */

import type { JwtPayload } from '@clerk/types';
import { Env, ClerkUser } from '../types';

/**
 * Verify a Clerk JWT token with proper authorized parties
 */
export async function verifyClerkToken(
  token: string,
  env: Env
): Promise<{ valid: boolean; userId?: string; email?: string }> {
  try {
    // Import Clerk's token verification
    const { verifyToken } = await import('@clerk/backend');
    
    // Build authorized parties list
    const authorizedParties: string[] = [];
    
    // Add frontend URLs
    if (env.FRONTEND_URL) {
      authorizedParties.push(env.FRONTEND_URL);
      // Add kizuna.ai domain variants
      if (env.FRONTEND_URL.includes('kizuna.ai')) {
        // Add both with and without www
        authorizedParties.push(env.FRONTEND_URL.replace('https://', 'https://www.'));
        // Add development variant if this is dev environment
        if (env.ENVIRONMENT === 'development') {
          authorizedParties.push('https://dev.sokuji.kizuna.ai');
        }
      }
    }
    
    // Always add localhost variants for Electron apps
    // Electron apps always run on localhost regardless of environment
    authorizedParties.push('http://localhost:3000');
    authorizedParties.push('http://localhost:5173');
    
    // Add extension URL
    if (env.EXTENSION_URL) {
      authorizedParties.push(env.EXTENSION_URL);
    }
    
    // Add extension local test URL
    authorizedParties.push('chrome-extension://gadldlbhlbfdigaldocgomkkjciajmel');
    
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      authorizedParties: authorizedParties.filter(Boolean),
      issuer: null // We don't need to validate the issuer
    });
    
    // // Temporary restriction: Only allow specific users
    // const allowedUsers = [
    //   'user_31E3feoFgbYN060lRGK3T5f9hkz',
    //   'user_2zK7oAYxuSF2xvZhbG8Qk9QtlDp',
    //   'user_31Z9tOTnGIV9omPDfzBmuXbzhBU'
    // ];
    //
    // if (!allowedUsers.includes(payload.sub)) {
    //   console.log('[Clerk] User not in allowed list:', payload.sub);
    //   return { valid: false };
    // }
    
    return {
      valid: true,
      userId: payload.sub,
      // Email is not a standard field in Clerk's JWT payload
      // It needs to be added as a custom claim in Clerk Dashboard
      email: (payload.email as string | undefined) || undefined
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    return { valid: false };
  }
}

/**
 * Get user data from Clerk
 */
export async function getClerkUser(userId: string, env: Env): Promise<ClerkUser | null> {
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch Clerk user:', response.statusText);
      return null;
    }
    
    return await response.json() as ClerkUser;
  } catch (error) {
    console.error('Error fetching Clerk user:', error);
    return null;
  }
}

/**
 * Update user metadata in Clerk
 */
export async function updateClerkUserMetadata(
  userId: string,
  publicMetadata: Record<string, any>,
  env: Env
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        public_metadata: publicMetadata
      })
    });
    
    return response.ok;
  } catch (error) {
    console.error('Error updating Clerk user metadata:', error);
    return false;
  }
}

/**
 * Ensure user exists in D1 database by syncing from Clerk if needed
 * This provides self-healing for missed webhooks and data consistency issues
 */
export async function ensureUserExists(userId: string, env: Env): Promise<boolean> {
  try {
    // Check if user already exists in D1
    const existingUser = await env.DB.prepare(
      'SELECT id FROM users WHERE clerk_id = ?'
    ).bind(userId).first();
    
    if (existingUser) {
      return true; // User already exists
    }
    
    console.log(`User ${userId} not found in D1, syncing from Clerk...`);
    
    // User doesn't exist, fetch from Clerk
    const clerkUser = await getClerkUser(userId, env);
    if (!clerkUser) {
      console.error(`User ${userId} not found in Clerk`);
      return false;
    }
    
    // Extract user data
    const email = clerkUser.email_addresses[0]?.email_address;
    if (!email) {
      console.error(`No email found for user ${userId}`);
      return false;
    }
    
    // Get subscription info from Clerk metadata
    const subscription = clerkUser.public_metadata?.subscription || 'free';
    const tokenQuota = clerkUser.public_metadata?.tokenQuota || getQuotaForPlan(subscription);
    
    try {
      // Create user in D1 using INSERT OR IGNORE to handle race conditions
      const result = await env.DB.prepare(`
        INSERT OR IGNORE INTO users (clerk_id, email, first_name, last_name, image_url, subscription, token_quota, tokens_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(
        userId,
        email,
        clerkUser.first_name || null,
        clerkUser.last_name || null,
        clerkUser.image_url || null,
        subscription,
        tokenQuota
      ).run();
      
      // Only initialize KV if user was actually created (not a duplicate)
      if (result.meta.changes > 0) {
        // Initialize quota in KV
        await env.QUOTA_KV.put(
          `quota:${userId}`,
          JSON.stringify({
            total: tokenQuota,
            used: 0,
            remaining: tokenQuota,
            resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          })
        );
        console.log(`Successfully synced user ${userId} from Clerk to D1`);
      } else {
        console.log(`User ${userId} was created by another process during sync`);
      }
      
      return true;
    } catch (insertError) {
      console.error(`Error inserting user ${userId} into D1:`, insertError);
      
      // Check if user exists now (might have been created by another process)
      const userCheck = await env.DB.prepare(
        'SELECT id FROM users WHERE clerk_id = ?'
      ).bind(userId).first();
      
      if (userCheck) {
        console.log(`User ${userId} exists after failed insert - concurrent creation`);
        return true;
      }
      
      return false;
    }
  } catch (error) {
    console.error(`Error ensuring user exists for ${userId}:`, error);
    return false;
  }
}

/**
 * Get quota for subscription plan
 */
function getQuotaForPlan(plan: string): number {
  const quotas: Record<string, number> = {
    free: 1000000,      // 1M tokens
    basic: 10000000,    // 10M tokens
    premium: 50000000,  // 50M tokens
    enterprise: -1      // Unlimited
  };
  return quotas[plan] || quotas.free;
}

/**
 * Verify Clerk webhook signature using Svix
 */
export async function verifyClerkWebhook(
  request: Request,
  env: Env
): Promise<{ valid: boolean; event?: any }> {
  try {
    // Import Svix for webhook verification
    const { Webhook } = await import('svix');
    
    // Get the raw request body
    const payload = await request.text();
    
    // Extract Svix headers from the request
    const headers = {
      'svix-id': request.headers.get('svix-id') || '',
      'svix-timestamp': request.headers.get('svix-timestamp') || '',
      'svix-signature': request.headers.get('svix-signature') || ''
    };
    
    // Verify headers are present
    if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) {
      console.error('Missing required Svix headers');
      return { valid: false };
    }
    
    // Create Webhook instance with the signing secret
    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
    
    // Verify the webhook signature and get the event
    const evt = wh.verify(payload, headers) as any;
    
    console.log(`Webhook event received: ${evt.type}`);
    return { valid: true, event: evt };
  } catch (error) {
    console.error('Webhook verification failed:', error);
    return { valid: false };
  }
}

/**
 * Create a session token for a user
 */
export function createSessionToken(userId: string, email?: string): string {
  const payload = {
    sub: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  };
  
  // In production, you would sign this JWT properly
  // For now, we'll use a simple base64 encoding
  return btoa(JSON.stringify(payload));
}

/**
 * Parse a session token
 */
export function parseSessionToken(token: string): JwtPayload | null {
  try {
    const payload = JSON.parse(atob(token)) as JwtPayload;
    
    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}