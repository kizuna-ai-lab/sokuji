/**
 * Subscription management routes
 * Handles subscription plans, billing, and quota management
 */

import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * Get available subscription plans
 */
app.get('/plans', async (c) => {
  const plans = [
    {
      id: 'free',
      name: 'Free',
      price: 0,
      interval: 'month',
      features: {
        tokensPerMonth: 1000000,  // 1M tokens
        apiKeys: 1,
        sessions: 1,
        support: 'community',
        providers: ['openai']
      }
    },
    {
      id: 'basic',
      name: 'Basic',
      price: 9.99,
      interval: 'month',
      priceId: 'price_basic_monthly', // Stripe price ID
      features: {
        tokensPerMonth: 10000000,  // 10M tokens
        apiKeys: 3,
        sessions: 3,
        support: 'email',
        providers: ['openai', 'gemini']
      }
    },
    {
      id: 'premium',
      name: 'Premium',
      price: 29.99,
      interval: 'month',
      priceId: 'price_premium_monthly',
      features: {
        tokensPerMonth: 50000000,  // 50M tokens
        apiKeys: 10,
        sessions: 10,
        support: 'priority',
        providers: ['openai', 'gemini', 'comet', 'palabra']
      }
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 'custom',
      interval: 'month',
      features: {
        tokensPerMonth: -1,  // unlimited
        apiKeys: -1,
        sessions: -1,
        support: 'dedicated',
        providers: ['all'],
        customization: true,
        sla: true
      }
    }
  ];
  
  return c.json({ plans });
});

/**
 * Get current subscription
 * Reads subscription data from Clerk user metadata
 */
app.get('/current', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user data from Clerk
  const { getClerkUser } = await import('../services/clerk');
  const clerkUser = await getClerkUser(userId, c.env);
  
  if (!clerkUser) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Get subscription info from Clerk public metadata
  const subscription = clerkUser.public_metadata?.subscription || 'free';
  const tokenQuota = clerkUser.public_metadata?.tokenQuota || 1000000;
  const tokensUsed = clerkUser.public_metadata?.tokensUsed || 0;
  const resetDate = clerkUser.public_metadata?.resetDate || 
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  
  // Get additional quota info from KV for real-time accuracy
  const quotaData = await c.env.QUOTA_KV.get(`quota:${userId}`);
  const kvQuota = quotaData ? JSON.parse(quotaData) : null;
  
  // Use KV data if available for most accurate usage info
  const quota = {
    total: tokenQuota,
    used: kvQuota?.used || tokensUsed,
    remaining: tokenQuota - (kvQuota?.used || tokensUsed),
    resetDate: resetDate
  };
  
  return c.json({
    subscription: {
      plan: subscription,
      status: 'active',
      features: getSubscriptionFeatures(subscription)
    },
    quota
  });
});

/**
 * Helper function to get subscription features
 */
function getSubscriptionFeatures(plan: string) {
  const features: Record<string, any> = {
    free: {
      tokensPerMonth: 1000000,
      apiKeys: 1,
      sessions: 1,
      support: 'community',
      providers: ['openai']
    },
    basic: {
      tokensPerMonth: 10000000,
      apiKeys: 3,
      sessions: 3,
      support: 'email',
      providers: ['openai', 'gemini']
    },
    premium: {
      tokensPerMonth: 50000000,
      apiKeys: 10,
      sessions: 10,
      support: 'priority',
      providers: ['openai', 'gemini', 'comet', 'palabra']
    },
    enterprise: {
      tokensPerMonth: -1,
      apiKeys: -1,
      sessions: -1,
      support: 'dedicated',
      providers: ['all']
    }
  };
  
  return features[plan] || features.free;
}

/**
 * Upgrade subscription through Clerk
 * Note: Actual subscription management is handled through Clerk Dashboard
 */
app.post('/upgrade', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { planId } = await c.req.json();
  
  // Return instructions to upgrade through Clerk
  return c.json({
    message: 'Please manage your subscription through your account settings',
    dashboardUrl: `${c.env.FRONTEND_URL}/settings/subscription`
  });
});





export default app;