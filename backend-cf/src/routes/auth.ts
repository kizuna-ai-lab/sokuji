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
 * Extract user ID from webhook event data
 */
function extractUserIdFromEvent(event: any): string | null {
  // Try different paths where user ID might be found
  if (event.data?.user_id) return event.data.user_id;
  
  // Only use data.id for user events (not for subscription or subscription item events)
  if (event.type?.startsWith('user.') && event.data?.id) return event.data.id;
  
  if (event.data?.payer?.user_id) return event.data.payer.user_id; // For subscription events
  if (event.data?.subscription?.user_id) return event.data.subscription.user_id;
  if (event.data?.metadata?.user_id) return event.data.metadata.user_id;
  return null;
}


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
  
  // Extract user ID from event data
  const clerkUserId = extractUserIdFromEvent(event);
  const eventId = event.evt_id || `${event.type}_${Date.now()}`;
  
  // Check for duplicate event (idempotency)
  const existingEvent = await c.env.DB.prepare(
    'SELECT id, processing_status FROM webhook_logs WHERE event_id = ?'
  ).bind(eventId).first();
  
  if (existingEvent) {
    console.log(`Webhook event ${eventId} already processed with status: ${existingEvent.processing_status}`);
    return c.json({ received: true, duplicate: true });
  }
  
  // Get client IP and headers for logging
  const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const headers = JSON.stringify({
    'user-agent': c.req.header('User-Agent'),
    'content-type': c.req.header('Content-Type'),
    'svix-id': c.req.header('svix-id'),
    'svix-timestamp': c.req.header('svix-timestamp'),
    'svix-signature': c.req.header('svix-signature')
  });
  
  // Record webhook event in database immediately
  let webhookLogId: number;
  try {
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO webhook_logs (
        event_id, event_type, clerk_user_id, raw_payload, headers, 
        webhook_signature, ip_address, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      eventId,
      event.type,
      clerkUserId,
      JSON.stringify(event),
      headers,
      c.req.header('svix-signature') || '',
      clientIP
    ).run();
    
    webhookLogId = insertResult.meta.last_row_id as number;
    console.log(`Webhook logged with ID: ${webhookLogId}`);
  } catch (logError) {
    console.error('Failed to log webhook event:', logError);
    // Continue processing even if logging fails
    webhookLogId = 0;
  }
  
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
        
      case 'subscriptionItem.active':
        await handleSubscriptionItemActive(event.data, c.env);
        break;
        
      case 'subscriptionItem.ended':
        await handleSubscriptionItemEnded(event.data, c.env);
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
    
    // Update webhook log status to success
    if (webhookLogId > 0) {
      try {
        await c.env.DB.prepare(`
          UPDATE webhook_logs 
          SET processing_status = 'success', processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(webhookLogId).run();
      } catch (updateError) {
        console.error('Failed to update webhook log status:', updateError);
      }
    }
    
    return c.json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook event ${event.type}:`, error);
    
    // Update webhook log status to failed
    if (webhookLogId > 0) {
      try {
        await c.env.DB.prepare(`
          UPDATE webhook_logs 
          SET processing_status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(error?.toString() || 'Unknown error', webhookLogId).run();
      } catch (updateError) {
        console.error('Failed to update webhook log error status:', updateError);
      }
    }
    
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
  
  try {
    // Use INSERT OR IGNORE to handle race conditions
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO users (
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
    
    // Only initialize KV if user was actually created (not a duplicate)
    if (result.meta.changes > 0) {
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
      console.log(`User ${clerkUser.id} created successfully`);
    } else {
      console.log(`User ${clerkUser.id} already exists, skipping creation`);
    }
  } catch (error) {
    console.error(`Error creating user ${clerkUser.id}:`, error);
    // Don't throw error - this might be a concurrent insert from another webhook
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
    const tokensUsed = subscription === 'free' ? 0 : Number(currentUser.tokens_used) || 0; // Reset usage for free tier
    
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
    fallback: 0,
    free_plan: 1000000,           // 1M tokens (plan slug format)
    starter_plan: 10000000,       // 10M tokens (plan slug format)
    essentials_plan: 50000000,    // 50M tokens (plan slug format)
    professional_plan: 100000000, // 100M tokens (plan slug format)
    business_plan: 500000000,     // 500M tokens (plan slug format)
    enterprise_plan: 1000000000,  // 1B tokens (plan slug format)
    unlimited_plan: -1            // Unlimited
  };
  
  return quotas[plan] || quotas.fallback;
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription: any, env: Env) {
  console.log('Subscription created:', subscription.id);
  
  // Get user ID from subscription data
  const userId = subscription.payer?.user_id || subscription.user_id || subscription.metadata?.user_id;
  if (!userId) {
    console.error('No user ID in subscription data');
    return;
  }
  
  // Ensure user exists in D1 (auto-sync from Clerk if needed)
  const userSynced = await ensureUserExists(userId, env);
  if (!userSynced) {
    console.error(`Failed to sync user ${userId} for subscription creation`);
    return;
  }
  
  // Extract plan details from subscription items or metadata
  const plan = subscription.items?.[0]?.plan?.slug || subscription.metadata?.plan || 'free_plan';
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
  
  // Get user ID from subscription data (check payer first)
  const userId = subscription.payer?.user_id || subscription.user_id || subscription.metadata?.user_id;
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
  
  // Find the active subscription item from the items array
  const activeItem = subscription.items?.find((item: any) => item.status === 'active');
  
  // Extract plan from active item or fallback to metadata/current subscription
  let plan = currentUser.subscription; // Default fallback
  if (activeItem?.plan?.slug) {
    plan = activeItem.plan.slug; // Use the slug as-is (starter_plan, essentials_plan, etc.)
  } else if (subscription.metadata?.plan) {
    plan = subscription.metadata.plan;
  }
  
  const tokenQuota = getQuotaForPlan(plan);
  
  // Update user subscription
  await env.DB.prepare(`
    UPDATE users 
    SET subscription = ?, token_quota = ?, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(plan, tokenQuota, userId).run();
  
  // Update quota in KV
  const tokensUsed = Number(currentUser.tokens_used) || 0;
  await env.QUOTA_KV.put(
    `quota:${userId}`,
    JSON.stringify({
      total: tokenQuota,
      used: tokensUsed,
      remaining: tokenQuota - tokensUsed,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  
  console.log(`User ${userId} subscription updated to ${plan} (from active item: ${activeItem?.plan?.slug || 'none'})`);
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription: any, env: Env) {
  console.log('Subscription deleted:', subscription.id);
  
  const userId = subscription.payer?.user_id || subscription.user_id || subscription.metadata?.user_id;
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
 * Handle subscription item active event
 */
async function handleSubscriptionItemActive(item: any, env: Env) {
  console.log('Subscription item activated:', item.id);
  
  // Get user ID from the item or payer data
  const userId = item.payer?.user_id || item.subscription?.user_id || item.metadata?.user_id;
  if (!userId) {
    console.error('No user ID in subscription item data');
    return;
  }
  
  // Ensure user exists in D1 (auto-sync from Clerk if needed)
  const userSynced = await ensureUserExists(userId, env);
  if (!userSynced) {
    console.error(`Failed to sync user ${userId} for subscription item activation`);
    return;
  }
  
  // Get current user data to preserve token usage
  const currentUser = await env.DB.prepare(
    'SELECT subscription, tokens_used FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!currentUser) {
    console.error(`User ${userId} not found after sync for subscription item activation`);
    return;
  }
  
  // Extract plan information from the subscription item
  const plan = item.plan?.slug || item.plan?.name || item.metadata?.plan || 'free_plan';
  const tokenQuota = getQuotaForPlan(plan);
  
  // Preserve current token usage unless downgrading to free plan
  const currentTokensUsed = Number(currentUser.tokens_used) || 0;
  const tokensUsed = plan === 'free_plan' ? 0 : currentTokensUsed; // Only reset for free plan
  
  // Update user subscription in database
  await env.DB.prepare(`
    UPDATE users 
    SET subscription = ?, token_quota = ?, tokens_used = ?, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_id = ?
  `).bind(plan, tokenQuota, tokensUsed, userId).run();
  
  // Update quota in KV
  await env.QUOTA_KV.put(
    `quota:${userId}`,
    JSON.stringify({
      total: tokenQuota,
      used: tokensUsed,
      remaining: tokenQuota - tokensUsed,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  );
  
  console.log(`User ${userId} subscription item activated: ${plan} with ${tokenQuota} tokens (preserved usage: ${tokensUsed})`);
}

/**
 * Handle subscription item ended event
 */
async function handleSubscriptionItemEnded(item: any, env: Env) {
  console.log('Subscription item ended:', item.id);
  
  // Get user ID from the item or payer data
  const userId = item.payer?.user_id || item.subscription?.user_id || item.metadata?.user_id;
  if (!userId) {
    console.error('No user ID in subscription item ended data');
    return;
  }
  
  // Extract plan information from the ended subscription item
  const endedPlan = item.plan?.slug || item.plan?.name || 'unknown';
  
  // Log the ended subscription item but don't take action
  // The active subscription items determine the current user plan
  console.log(`User ${userId} subscription item ended: ${endedPlan} (status: ${item.status})`);
  
  // Note: We don't update the user's subscription here because:
  // 1. There might be other active subscription items
  // 2. The subscription.updated webhook will handle the overall subscription state
  // 3. Active subscription items take precedence over ended ones
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

/**
 * Get webhook logs endpoint - for debugging and monitoring
 * Admin only endpoint
 */
app.get('/webhook-logs', adminMiddleware, async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 1000);
  const offset = parseInt(c.req.query('offset') || '0');
  const status = c.req.query('status'); // pending, success, failed
  const eventType = c.req.query('event_type');
  
  let query = 'SELECT * FROM webhook_logs';
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (status) {
    conditions.push('processing_status = ?');
    params.push(status);
  }
  
  if (eventType) {
    conditions.push('event_type = ?');
    params.push(eventType);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  try {
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    // Also get total count
    let countQuery = 'SELECT COUNT(*) as total FROM webhook_logs';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    
    const countParams = params.slice(0, -2); // Remove limit and offset
    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first();
    
    return c.json({
      logs: result.results,
      pagination: {
        total: countResult?.total || 0,
        limit,
        offset,
        hasMore: (countResult?.total || 0) > offset + limit
      }
    });
  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    return c.json({ error: 'Failed to fetch webhook logs' }, 500);
  }
});

/**
 * Get webhook statistics endpoint
 * Admin only endpoint
 */
app.get('/webhook-stats', adminMiddleware, async (c) => {
  try {
    const stats = await c.env.DB.prepare(`
      SELECT 
        processing_status,
        COUNT(*) as count,
        MIN(created_at) as first_event,
        MAX(created_at) as last_event
      FROM webhook_logs 
      GROUP BY processing_status
    `).all();
    
    const eventTypes = await c.env.DB.prepare(`
      SELECT 
        event_type,
        COUNT(*) as count,
        processing_status,
        MAX(created_at) as last_seen
      FROM webhook_logs 
      GROUP BY event_type, processing_status
      ORDER BY count DESC
    `).all();
    
    return c.json({
      statusStats: stats.results,
      eventTypeStats: eventTypes.results
    });
  } catch (error) {
    console.error('Error fetching webhook stats:', error);
    return c.json({ error: 'Failed to fetch webhook statistics' }, 500);
  }
});

/**
 * Retry failed webhook endpoint
 * Admin only endpoint for reprocessing failed webhooks
 */
app.post('/webhook-logs/:id/retry', adminMiddleware, async (c) => {
  const logId = c.req.param('id');
  
  try {
    // Get the webhook log
    const webhookLog = await c.env.DB.prepare(
      'SELECT * FROM webhook_logs WHERE id = ? AND processing_status = ?'
    ).bind(logId, 'failed').first();
    
    if (!webhookLog) {
      return c.json({ error: 'Webhook log not found or not in failed state' }, 404);
    }
    
    // Parse the raw payload and reprocess
    const event = JSON.parse(webhookLog.raw_payload as string);
    
    // Update retry count
    await c.env.DB.prepare(`
      UPDATE webhook_logs 
      SET retry_count = retry_count + 1, processing_status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(logId).run();
    
    // Note: For a complete implementation, you would reprocess the event here
    // For now, we'll just mark it as pending for manual review
    
    return c.json({ 
      success: true, 
      message: 'Webhook marked for retry',
      retryCount: (webhookLog.retry_count as number) + 1
    });
  } catch (error) {
    console.error('Error retrying webhook:', error);
    return c.json({ error: 'Failed to retry webhook' }, 500);
  }
});

export default app;