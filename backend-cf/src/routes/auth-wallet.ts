/**
 * Authentication routes with Wallet Model
 * Handles Clerk webhooks for wallet-based token management
 */

import { Hono } from 'hono';
import { Env, HonoVariables } from '../types';
import { verifyClerkWebhook, ensureUserExists } from '../services/clerk';
import { createWalletService } from '../services/wallet';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

/**
 * Extract user ID from webhook event data
 */
function extractUserIdFromEvent(event: any): string | null {
  // Payment events
  if (event.data?.payer?.user_id) return event.data.payer.user_id;
  
  // User events
  if (event.type?.startsWith('user.') && event.data?.id) return event.data.id;
  if (event.data?.user_id) return event.data.user_id;
  
  // Subscription events
  if (event.data?.subscription?.user_id) return event.data.subscription.user_id;
  if (event.data?.metadata?.user_id) return event.data.metadata.user_id;
  
  return null;
}

/**
 * Extract plan ID from subscription or payment data
 */
function extractPlanId(data: any): string {
  // From payment event's subscription_items (for paymentAttempt.updated)
  if (data.subscription_items?.length > 0) {
    // Get the first subscription item's plan slug
    const item = data.subscription_items[0];
    if (item?.plan?.slug) return item.plan.slug;
  }
  
  // From subscription items (for subscription events)
  if (data.items?.length > 0) {
    const activeItem = data.items.find((item: any) => item.status === 'active');
    if (activeItem?.plan?.slug) return activeItem.plan.slug;
  }
  
  // From subscription item directly
  if (data.plan?.slug) return data.plan.slug;
  
  // From metadata
  if (data.metadata?.plan) return data.metadata.plan;
  
  // Default
  return 'free_plan';
}

/**
 * Clerk webhook endpoint - Wallet Model
 * Only mints tokens on successful payment
 */
app.post('/webhook/clerk', async (c) => {
  // Verify webhook signature
  const result = await verifyClerkWebhook(c.req.raw, c.env);
  
  if (!result.valid || !result.event) {
    return c.text('Invalid signature', 401);
  }
  
  const event = result.event;
  const eventType = event.type;
  
  // Get event timestamp first for use in eventId
  const eventTimestamp = event.timestamp || event.created_at;
  // Get svix-id from headers for unique event identification
  const svixId = c.req.header('svix-id');
  // Priority: 1. svix-id from headers (guaranteed unique), 2. evt_id from Clerk, 3. generated from type+timestamp
  const eventId = svixId || event.evt_id || `${eventType}_${eventTimestamp || Date.now()}`;
  
  console.log(`Processing webhook: ${eventType} (${eventId})`);
  
  // Check timestamp (reject events older than 7 days)
  if (eventTimestamp) {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const eventTime = new Date(eventTimestamp).getTime();
    if (eventTime < sevenDaysAgo) {
      console.log(`Rejecting old event ${eventId} from ${new Date(eventTime).toISOString()}`);
      return c.json({ received: true, rejected: 'too_old' });
    }
  }
  
  // Check for duplicate (idempotency)
  const existing = await c.env.DB.prepare(
    'SELECT event_id FROM processed_events WHERE event_id = ?'
  ).bind(eventId).first();
  console.log(`Existing event ${eventId}`,existing);

  if (existing) {
    console.log(`Event ${eventId} already processed`);
    return c.json({ received: true, duplicate: true });
  }
  
  // Extract user ID
  const userId = extractUserIdFromEvent(event);
  
  // Get client IP and headers for logging
  const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const headers = JSON.stringify({
    'user-agent': c.req.header('User-Agent'),
    'content-type': c.req.header('Content-Type'),
    'svix-id': c.req.header('svix-id'),
    'svix-timestamp': c.req.header('svix-timestamp'),
    'svix-signature': c.req.header('svix-signature')
  });
  
  // Record webhook event in webhook_logs table for audit trail
  let webhookLogId: number | undefined;
  try {
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO webhook_logs (
        event_id, event_type, clerk_user_id, raw_payload, headers, 
        webhook_signature, ip_address, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      eventId,
      eventType,
      userId || null,
      JSON.stringify(event),
      headers,
      c.req.header('svix-signature') || null,
      clientIP
    ).run();
    
    webhookLogId = insertResult.meta.last_row_id as number;
    console.log(`Webhook event ${eventId} logged with ID ${webhookLogId}`);
  } catch (error) {
    console.error('Error logging webhook event:', error);
    // Continue processing even if logging fails
  }
  
  // Initialize wallet service
  const walletService = createWalletService(c.env);
  
  try {
    // Process event based on type
    switch (eventType) {
      // === PAYMENT EVENTS (CRITICAL - MINT TOKENS) ===
      case 'paymentAttempt.updated': {
        const payment = event.data;

        // Only process successful payments (status: 'paid')
        if (payment.status !== 'paid') {
          console.log(`Payment ${payment.id} status is ${payment.status}, skipping mint`);
          break;
        }

        if (!userId) {
          console.error('No user ID in payment data');
          break;
        }

        // Ensure user exists
        await ensureUserExists(userId, c.env);

        // Extract payment details
        // Use grand_total (actual amount paid after credits/proration)
        const amountCents = payment.totals?.grand_total?.amount || 0;
        const planId = extractPlanId(payment);
        const paymentId = payment.payment_id || payment.id;
        
        console.log(`Payment ${paymentId} for user ${userId} (plan: ${planId}, amount: $${amountCents/100})`);

        // Mint tokens based on actual payment amount
        const mintResult = await walletService.mintTokens({
          subjectType: 'user',
          subjectId: userId,
          planId: planId,
          amountCents: amountCents,
          externalEventId: eventId,
          metadata: {
            paymentId: paymentId,
            paymentAttemptId: payment.id,
            paymentMethod: payment.payment_source?.payment_method || 'card',
            currency: payment.totals?.grand_total?.currency || 'USD',
            subtotal: payment.totals?.subtotal?.amount,
            credits: payment.subscription_items?.[0]?.credit?.amount?.amount
          }
        });

        if (mintResult.success) {
          console.log(`Minted ${mintResult.minted} tokens for user ${userId} (payment: $${amountCents / 100})`);
        } else {
          console.error(`Failed to mint tokens: ${mintResult.error}`);
        }

        break;
      }

      // === SUBSCRIPTION EVENTS (UPDATE ENTITLEMENTS ONLY) ===
      case 'subscription.created':
      case 'subscription.updated': {
        const subscription = event.data;

        if (!userId) {
          console.error('No user ID in subscription data');
          break;
        }

        // Ensure user exists
        await ensureUserExists(userId, c.env);

        // Extract plan and update entitlements (NOT balance)
        const planId = extractPlanId(subscription);
        await walletService.updateEntitlements('user', userId, planId);

        // Handle subscription status for freezing
        if (subscription.status === 'past_due' || subscription.status === 'canceled') {
          await walletService.setFrozenStatus('user', userId, true);
          console.log(`Froze wallet for user ${userId} (subscription: ${subscription.status})`);
        } else if (subscription.status === 'active') {
          await walletService.setFrozenStatus('user', userId, false);
          console.log(`Unfroze wallet for user ${userId} (subscription: active)`);
        }

        console.log(`Updated entitlements for user ${userId} to plan ${planId}`);
        break;
      }

      case 'subscription.active': {
        const subscription = event.data;

        if (!userId) {
          console.error('No user ID in subscription.active event');
          break;
        }

        // Ensure user exists
        await ensureUserExists(userId, c.env);

        // Extract plan and update entitlements
        const planId = extractPlanId(subscription);
        await walletService.updateEntitlements('user', userId, planId);

        // Unfreeze wallet - subscription is now active (payment successful)
        await walletService.setFrozenStatus('user', userId, false);

        console.log(`Subscription activated for user ${userId}, unfroze wallet (plan: ${planId})`);
        break;
      }

      case 'subscription.past_due': {
        const subscription = event.data;

        if (!userId) {
          console.error('No user ID in subscription.past_due event');
          break;
        }

        // Freeze wallet - payment failed but subscription not canceled yet
        await walletService.setFrozenStatus('user', userId, true);

        // Keep current entitlements (grace period) but wallet is frozen
        console.log(`Subscription past due for user ${userId}, froze wallet`);
        break;
      }

      // === USER EVENTS (INITIALIZATION) ===
      case 'user.created': {
        const clerkUser = event.data;

        // Initialize user with free plan
        await ensureUserExists(clerkUser.id, c.env);
        await walletService.updateEntitlements('user', clerkUser.id, 'free_plan');

        console.log(`User ${clerkUser.id} created with free plan`);
        break;
      }

      case 'user.deleted': {
        const clerkUser = event.data;

        // We don't delete wallet data (audit trail)
        // Just mark as frozen
        await walletService.setFrozenStatus('user', clerkUser.id, true);

        console.log(`User ${clerkUser.id} deleted, wallet frozen`);
        break;
      }

      // === SESSION EVENTS (NO ACTION NEEDED) ===
      case 'session.created':
      case 'session.ended':
      case 'session.removed':
      case 'session.revoked':
        // Sessions don't affect wallet balance
        console.log(`Session event ${eventType} - no wallet action needed`);
        break;

      default:
        console.log(`Unhandled event type: ${eventType}`);
    }
    
    // Mark event as processed
    console.log(`[SUCCESS] Inserting eventId '${eventId}' into processed_events`);
    const insertResult = await c.env.DB.prepare(
      'INSERT INTO processed_events (event_id) VALUES (?)'
    ).bind(eventId).run();
    console.log(`[SUCCESS] Insert result:`, JSON.stringify(insertResult.meta));
    
    // Update webhook_logs status to success
    if (webhookLogId) {
      await c.env.DB.prepare(`
        UPDATE webhook_logs 
        SET processing_status = 'success', 
            processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
      `).bind(webhookLogId).run();
    }
    
    return c.json({ received: true, processed: true });
    
  } catch (error) {
    console.error(`Error processing webhook ${eventType}:`, error);
    
    // Still mark as processed to avoid infinite retries
    console.log(`[ERROR] Inserting eventId '${eventId}' into processed_events (with IGNORE)`);
    const errorInsertResult = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO processed_events (event_id) VALUES (?)'
    ).bind(eventId).run();
    console.log(`[ERROR] Insert result:`, JSON.stringify(errorInsertResult.meta));
    
    // Update webhook_logs status to failed
    if (webhookLogId) {
      await c.env.DB.prepare(`
        UPDATE webhook_logs 
        SET processing_status = 'failed', 
            processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            error_message = ?
        WHERE id = ?
      `).bind(
        error instanceof Error ? error.message : 'Unknown error',
        webhookLogId
      ).run();
    }
    
    return c.json({ 
      received: true, 
      error: c.env.ENVIRONMENT === 'development' && error instanceof Error ? error.message : 'Processing error'
    }, 500);
  }
});

/**
 * Sign-in page redirect (unchanged)
 */
app.get('/signin', (c) => {
  const method = c.req.query('method');
  const isExtension = c.req.query('extension') === 'true';
  
  const signInUrl = `https://accounts.${c.env.CLERK_PUBLISHABLE_KEY.replace('pk_', '')}.clerk.accounts.dev/sign-in`;
  
  return c.redirect(signInUrl);
});

/**
 * Token refresh endpoint (unchanged)
 */
app.post('/refresh', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const token = c.get('token');
  
  return c.json({
    success: true,
    token: token,
    userId: userId
  });
});

/**
 * User status endpoint (unchanged)
 */
app.get('/status', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  const user = await c.env.DB.prepare(
    'SELECT id, email, first_name, last_name, image_url FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json({
    authenticated: true,
    user: {
      id: userId,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      imageUrl: user.image_url
    }
  });
});

export default app;