/**
 * Authentication routes
 * Handles user authentication, token refresh, and session management
 */

import { Hono } from 'hono';
import { Env, User, HonoVariables } from '../types';
import { verifyClerkToken, getClerkUser, verifyClerkWebhook, updateClerkUserMetadata, ensureUserExists } from '../services/clerk';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();


/**
 * Sign-in page redirect
 */
app.get('/signin', (c) => {
  const method = c.req.query('method');
  const isExtension = c.req.query('extension') === 'true';
  
  const signInUrl = `https://accounts.${c.env.CLERK_PUBLISHABLE_KEY.replace('pk_', '')}.clerk.accounts.dev/sign-in`;
  
  return c.redirect(signInUrl);
});




/**
 * Clerk webhook endpoint
 * Handles user, subscription, and session events
 * 
 * Session Events:
 * - session.created: New session started
 * - session.pending: Session in pending state (e.g., awaiting MFA)
 * - session.ended: Session ended normally
 * - session.removed: Session was removed
 * - session.revoked: Session was revoked/force logged out
 */
app.post('/webhook/clerk', async (c) => {
  // Verify webhook signature with native Clerk verification
  const result = await verifyClerkWebhook(c.req.raw, c.env);
  
  if (!result.valid || !result.event) {
    return c.text('Invalid signature', 401);
  }
  
  const event = result.event;
  console.log(`Processing webhook event: ${event.type}`);
  
  try {
    switch (event.type) {
      // User events
      case 'user.created':
        await handleUserCreated(event.data, c.env);
        break;
        
      case 'user.updated':
        await handleUserUpdated(event.data, c.env);
        break;
        
      case 'user.deleted':
        await handleUserDeleted(event.data, c.env);
        break;
      
      // Subscription events
      case 'subscription.created':
        await handleSubscriptionCreated(event.data, c.env);
        break;
        
      case 'subscription.updated':
        await handleSubscriptionUpdated(event.data, c.env);
        break;
        
      case 'subscription.deleted':
        await handleSubscriptionDeleted(event.data, c.env);
        break;
      
      // Subscription item events
      case 'subscriptionItem.created':
      case 'subscriptionItem.updated':
        await handleSubscriptionItemChanged(event.data, c.env);
        break;
        
      case 'subscriptionItem.deleted':
        await handleSubscriptionItemDeleted(event.data, c.env);
        break;
      
      // Session events
      case 'session.created':
        await handleSessionCreated(event.data, c.env);
        break;
        
      case 'session.ended':
      case 'session.removed':
      case 'session.revoked':
        await handleSessionTerminated(event.data, c.env);
        break;
        
      case 'session.pending':
        await handleSessionPending(event.data, c.env);
        break;
      
      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }
    
    return c.json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook event ${event.type}:`, error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

/**
 * Handle user creation from Clerk webhook
 */
async function handleUserCreated(clerkUser: any, env: Env) {
  const email = clerkUser.email_addresses[0]?.email_address;
  if (!email) return;
  
  // Get subscription info from Clerk metadata
  const subscription = clerkUser.public_metadata?.subscription || 'free';
  const tokenQuota = clerkUser.public_metadata?.tokenQuota || getQuotaForPlan(subscription);
  const resetDate = clerkUser.public_metadata?.resetDate || 
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  
  // Check if user already exists
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE clerk_id = ?'
  ).bind(clerkUser.id).first();
  
  if (!existing) {
    // Create user in database
    await env.DB.prepare(`
      INSERT INTO users (
        clerk_id, email, first_name, last_name, image_url, 
        subscription, token_quota
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      clerkUser.id,
      email,
      clerkUser.first_name,
      clerkUser.last_name,
      clerkUser.image_url,
      subscription,
      tokenQuota
    ).run();
    
    // Initialize user quota in KV
    await env.QUOTA_KV.put(
      `quota:${clerkUser.id}`,
      JSON.stringify({
        total: tokenQuota,
        used: 0,
        remaining: tokenQuota,
        resetDate: resetDate
      })
    );
  }
}

/**
 * Handle user update from Clerk webhook
 */
async function handleUserUpdated(clerkUser: any, env: Env) {
  const email = clerkUser.email_addresses[0]?.email_address;
  if (!email) return;
  
  // Get subscription info from Clerk metadata
  const subscription = clerkUser.public_metadata?.subscription || 'free';
  const tokenQuota = clerkUser.public_metadata?.tokenQuota || getQuotaForPlan(subscription);
  const resetDate = clerkUser.public_metadata?.resetDate;
  
  // Get current user data to check for subscription changes
  const currentUser = await env.DB.prepare(
    'SELECT subscription, token_quota, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(clerkUser.id).first();
  
  // Update user in database
  await env.DB.prepare(`
    UPDATE users 
    SET email = ?, first_name = ?, last_name = ?, image_url = ?, 
        subscription = ?, token_quota = ?, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(
    email,
    clerkUser.first_name,
    clerkUser.last_name,
    clerkUser.image_url,
    subscription,
    tokenQuota,
    clerkUser.id
  ).run();
  
  // If subscription changed, update quota in KV
  if (currentUser && (currentUser.subscription !== subscription || currentUser.token_quota !== tokenQuota)) {
    // Handle subscription upgrade/downgrade
    const tokensUsed = subscription === 'free' ? 0 : currentUser.tokens_used; // Reset usage for free tier
    
    await env.QUOTA_KV.put(
      `quota:${clerkUser.id}`,
      JSON.stringify({
        total: tokenQuota,
        used: tokensUsed,
        remaining: tokenQuota - tokensUsed,
        resetDate: resetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    );
    
    // If downgraded to free, reset tokens used
    if (subscription === 'free' && currentUser.subscription !== 'free') {
      await env.DB.prepare(
        'UPDATE users SET tokens_used = 0 WHERE clerk_id = ?'
      ).bind(clerkUser.id).run();
    }
  }
}

/**
 * Handle user deletion from Clerk webhook
 */
async function handleUserDeleted(clerkUser: any, env: Env) {
  // Delete user and cascade delete related records
  await env.DB.prepare(
    'DELETE FROM users WHERE clerk_id = ?'
  ).bind(clerkUser.id).run();
  
  // Clean up KV storage
  await env.QUOTA_KV.delete(`quota:${clerkUser.id}`);
  await env.SESSION_KV.delete(`session:${clerkUser.id}`);
}

/**
 * Get token quota for a subscription plan
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
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription: any, env: Env) {
  console.log('Subscription created:', subscription.id);
  
  // Get user ID from subscription metadata
  const userId = subscription.user_id || subscription.metadata?.user_id;
  if (!userId) {
    console.error('No user ID in subscription data');
    return;
  }
  
  // Extract plan details
  const plan = subscription.metadata?.plan || 'basic';
  const tokenQuota = getQuotaForPlan(plan);
  
  // Update user subscription in database
  await env.DB.prepare(`
    UPDATE users 
    SET subscription = ?, token_quota = ?, tokens_used = 0, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(plan, tokenQuota, userId).run();
  
  // Update quota in KV
  await env.QUOTA_KV.put(
    `quota:${userId}`,
    JSON.stringify({
      total: tokenQuota,
      used: 0,
      remaining: tokenQuota,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  
  console.log(`User ${userId} upgraded to ${plan} with ${tokenQuota} tokens`);
}

/**
 * Handle subscription update
 */
async function handleSubscriptionUpdated(subscription: any, env: Env) {
  console.log('Subscription updated:', subscription.id);
  
  const userId = subscription.user_id || subscription.metadata?.user_id;
  if (!userId) {
    console.error('No user ID in subscription data');
    return;
  }
  
  // Ensure user exists in D1 (auto-sync from Clerk if needed)
  const userSynced = await ensureUserExists(userId, env);
  if (!userSynced) {
    console.error(`Failed to sync user ${userId} for subscription update`);
    return;
  }
  
  // Get current user data
  const currentUser = await env.DB.prepare(
    'SELECT subscription, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!currentUser) {
    console.error(`User ${userId} still not found after sync`);
    return;
  }
  
  const plan = subscription.metadata?.plan || currentUser.subscription;
  const tokenQuota = getQuotaForPlan(plan);
  
  // Update user subscription
  await env.DB.prepare(`
    UPDATE users 
    SET subscription = ?, token_quota = ?, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(plan, tokenQuota, userId).run();
  
  // Update quota in KV
  await env.QUOTA_KV.put(
    `quota:${userId}`,
    JSON.stringify({
      total: tokenQuota,
      used: currentUser.tokens_used || 0,
      remaining: tokenQuota - (currentUser.tokens_used || 0),
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  
  console.log(`User ${userId} subscription updated to ${plan}`);
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription: any, env: Env) {
  console.log('Subscription deleted:', subscription.id);
  
  const userId = subscription.user_id || subscription.metadata?.user_id;
  if (!userId) {
    console.error('No user ID in subscription data');
    return;
  }
  
  // Downgrade user to free tier
  const freeQuota = getQuotaForPlan('free');
  
  await env.DB.prepare(`
    UPDATE users 
    SET subscription = 'free', token_quota = ?, tokens_used = 0, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(freeQuota, userId).run();
  
  // Reset quota in KV
  await env.QUOTA_KV.put(
    `quota:${userId}`,
    JSON.stringify({
      total: freeQuota,
      used: 0,
      remaining: freeQuota,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  
  console.log(`User ${userId} downgraded to free tier`);
}

/**
 * Handle subscription item changes
 */
async function handleSubscriptionItemChanged(item: any, env: Env) {
  console.log('Subscription item changed:', item.id);
  
  // If the item contains plan information, update the user's subscription
  const userId = item.subscription?.user_id || item.metadata?.user_id;
  if (!userId) return;
  
  const plan = item.price?.metadata?.plan || item.metadata?.plan;
  if (!plan) return;
  
  const tokenQuota = getQuotaForPlan(plan);
  
  await env.DB.prepare(`
    UPDATE users 
    SET subscription = ?, token_quota = ?, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(plan, tokenQuota, userId).run();
  
  console.log(`User ${userId} subscription item updated to ${plan}`);
}

/**
 * Handle subscription item deletion
 */
async function handleSubscriptionItemDeleted(item: any, env: Env) {
  console.log('Subscription item deleted:', item.id);
  
  // When a subscription item is deleted, typically means downgrade
  const userId = item.subscription?.user_id || item.metadata?.user_id;
  if (!userId) return;
  
  // Check if user still has other active subscription items
  // For now, we'll assume deletion means downgrade to free
  await handleSubscriptionDeleted({ user_id: userId }, env);
}

/**
 * Handle session creation
 */
async function handleSessionCreated(session: any, env: Env) {
  console.log('Session created:', session.id);
  
  const userId = session.user_id;
  if (!userId) return;
  
  // Ensure user exists in D1 (auto-sync from Clerk if needed)
  const userSynced = await ensureUserExists(userId, env);
  if (!userSynced) {
    console.error(`Failed to sync user ${userId} for session creation`);
    return;
  }
  
  console.log(`Session ${session.id} created for user ${userId}`);
}

/**
 * Handle session pending state
 */
async function handleSessionPending(session: any, env: Env) {
  console.log('Session pending:', session.id);
  
  const userId = session.user_id;
  if (!userId) return;
  
  // Ensure user exists in D1 (auto-sync from Clerk if needed)
  const userSynced = await ensureUserExists(userId, env);
  if (!userSynced) {
    console.error(`Failed to sync user ${userId} for session pending`);
    return;
  }
  
  console.log(`Session ${session.id} marked as pending for user ${userId}`);
}

/**
 * Handle session termination (ended, removed, or revoked)
 */
async function handleSessionTerminated(session: any, env: Env) {
  console.log('Session terminated:', session.id);
  
  const userId = session.user_id;
  if (!userId) return;
  
  // Ensure user exists in D1 (auto-sync from Clerk if needed)
  // This handles cases where session.ended arrives before user.created
  const userSynced = await ensureUserExists(userId, env);
  if (!userSynced) {
    console.error(`Failed to sync user ${userId} for session end`);
    return;
  }
  
  console.log(`Session ${session.id} terminated for user ${userId}`);
}

/**
 * Manual sync endpoint to sync all users from Clerk to D1
 * Admin only endpoint for data consistency recovery
 */
app.post('/sync-all-users', adminMiddleware, async (c) => {
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  try {
    // Fetch all users from Clerk (paginated)
    let hasMore = true;
    let offset = 0;
    const limit = 100;
    
    while (hasMore) {
      const response = await fetch(
        `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`,
        {
          headers: {
            'Authorization': `Bearer ${c.env.CLERK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch users from Clerk: ${response.statusText}`);
      }
      
      const data = await response.json();
      const users = data.data || [];
      
      // Process each user
      for (const clerkUser of users) {
        try {
          // Check if user already exists
          const existing = await c.env.DB.prepare(
            'SELECT id FROM users WHERE clerk_id = ?'
          ).bind(clerkUser.id).first();
          
          if (existing) {
            skipped++;
            continue;
          }
          
          // Use ensureUserExists to sync the user
          const success = await ensureUserExists(clerkUser.id, c.env);
          if (success) {
            synced++;
          } else {
            failed++;
            errors.push(`Failed to sync user ${clerkUser.id}`);
          }
        } catch (error) {
          failed++;
          errors.push(`Error syncing user ${clerkUser.id}: ${error.message}`);
          console.error(`Error syncing user ${clerkUser.id}:`, error);
        }
      }
      
      // Check if there are more users
      hasMore = users.length === limit;
      offset += limit;
    }
    
    return c.json({
      success: true,
      synced,
      failed,
      skipped,
      errors: errors.slice(0, 10), // Return first 10 errors
      message: `Sync complete: ${synced} synced, ${skipped} skipped, ${failed} failed`
    });
  } catch (error) {
    console.error('Error in sync-all-users:', error);
    return c.json({
      success: false,
      error: error.message,
      synced,
      failed,
      skipped
    }, 500);
  }
});

/**
 * Single user sync endpoint - syncs a specific user from Clerk to D1
 */
app.post('/sync-user/:userId', adminMiddleware, async (c) => {
  const userId = c.req.param('userId');
  
  try {
    const success = await ensureUserExists(userId, c.env);
    
    if (success) {
      return c.json({
        success: true,
        message: `User ${userId} synced successfully`
      });
    } else {
      return c.json({
        success: false,
        error: `Failed to sync user ${userId}`
      }, 500);
    }
  } catch (error) {
    console.error(`Error syncing user ${userId}:`, error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default app;