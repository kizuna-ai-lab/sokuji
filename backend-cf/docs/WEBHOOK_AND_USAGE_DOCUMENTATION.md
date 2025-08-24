# Webhook Event Handling and Token Usage Management Documentation

## Overview

The Sokuji backend uses Clerk webhooks for user and subscription management, combined with real-time token usage tracking through API proxy and WebSocket relay endpoints. This document explains how webhook events affect user attributes and how token usage is calculated and updated.

## Table of Contents
1. [Webhook Event Processing Pipeline](#webhook-event-processing-pipeline)
2. [Webhook Event Types and Their Impact](#webhook-event-types-and-their-impact)
3. [Token Usage Tracking System](#token-usage-tracking-system)
4. [Database Schema and Fields](#database-schema-and-fields)
5. [Quota Calculation Logic](#quota-calculation-logic)

## Webhook Event Processing Pipeline

### 1. Webhook Reception and Verification

The webhook endpoint at `/api/auth/webhook/clerk` receives events from Clerk:

```typescript
// Entry point: src/routes/auth.ts:56
app.post('/webhook/clerk', async (c) => {
  // Step 1: Verify webhook signature using Svix
  const result = await verifyClerkWebhook(c.req.raw, c.env);
  
  // Step 2: Extract user ID from event data
  const clerkUserId = extractUserIdFromEvent(event);
  
  // Step 3: Check for duplicate events (idempotency)
  const existingEvent = await c.env.DB.prepare(
    'SELECT id FROM webhook_logs WHERE event_id = ?'
  ).bind(eventId).first();
  
  // Step 4: Log webhook event to database
  await c.env.DB.prepare(`
    INSERT INTO webhook_logs (
      event_id, event_type, clerk_user_id, raw_payload, 
      headers, webhook_signature, ip_address, processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(...).run();
  
  // Step 5: Process event based on type
  switch (event.type) {
    case 'user.created': ...
    case 'subscription.created': ...
    // etc.
  }
  
  // Step 6: Update webhook log status
  await c.env.DB.prepare(`
    UPDATE webhook_logs 
    SET processing_status = 'success'
    WHERE id = ?
  `).bind(webhookLogId).run();
});
```

### 2. Idempotency Protection

- Each webhook event has a unique `event_id`
- Database constraint prevents duplicate processing
- `webhook_logs` table tracks processing status: `pending`, `success`, `failed`
- Failed events can be retried via admin endpoint

## Webhook Event Types and Their Impact

### User Events

#### `user.created`
**Handler**: `handleUserCreated` (line 219)
**Database Impact**:
- Creates new record in `users` table
- Sets initial fields:
  - `subscription`: from Clerk metadata or 'free'
  - `token_quota`: based on subscription plan
  - `tokens_used`: 0
- Initializes KV storage for real-time quota tracking

#### `user.updated`
**Handler**: `handleUserUpdated` (line 271)
**Database Impact**:
- Updates user profile fields (email, name, image_url)
- Updates subscription and token_quota if changed
- For downgrades to free tier: resets `tokens_used` to 0
- Updates KV quota storage

#### `user.deleted`
**Handler**: `handleUserDeleted` (line 328)
**Database Impact**:
- Deletes user record (cascades to usage_logs)
- Cleans up KV storage entries

### Subscription Events

#### `subscription.created`
**Handler**: `handleSubscriptionCreated` (line 357)
**Database Impact**:
- Updates user's `subscription` field to new plan
- Sets `token_quota` based on plan:
  - `free_plan`: 0 tokens
  - `starter_plan`: 10,000,000 tokens
  - `essentials_plan`: 50,000,000 tokens
  - `enterprise_plan`: -1 (unlimited)
- Resets `tokens_used` to 0
- Updates KV quota storage

#### `subscription.updated`
**Handler**: `handleSubscriptionUpdated` (line 402)
**Database Impact**:
- Extracts active plan from subscription items
- Updates `subscription` and `token_quota`
- Preserves current `tokens_used` value
- Recalculates remaining quota in KV

#### `subscription.deleted`
**Handler**: `handleSubscriptionDeleted` (line 467)
**Database Impact**:
- Downgrades user to free tier
- Sets `subscription` to 'free'
- Sets `token_quota` to free plan limit
- Resets `tokens_used` to 0

### Subscription Item Events

#### `subscriptionItem.active`
**Handler**: `handleSubscriptionItemActive` (line 526)
**Database Impact**:
- Activates specific subscription item
- Updates plan based on item details
- Preserves token usage unless downgrading to free
- Updates quota in KV storage

#### `subscriptionItem.ended`
**Handler**: `handleSubscriptionItemEnded` (line 585)
**Database Impact**:
- Logs the ended item but doesn't immediately change subscription
- Waits for `subscription.updated` event for overall state

### Session Events

#### `session.created`, `session.pending`, `session.ended`
**Handlers**: `handleSessionCreated`, `handleSessionPending`, `handleSessionTerminated`
**Database Impact**:
- Triggers `ensureUserExists` to sync user from Clerk if missing
- Provides self-healing for missed `user.created` webhooks
- No direct impact on quotas or usage

## Token Usage Tracking System

### 1. REST API Proxy Usage Tracking

Location: `src/routes/proxy.ts`

```typescript
// For successful POST requests to OpenAI-compatible endpoints
if (response.ok && c.req.method === 'POST') {
  const responseBody = await clonedResponse.json();
  
  if (responseBody.usage) {
    const usage = responseBody.usage;
    const totalTokens = usage.total_tokens || 0;
    
    // Insert into usage_logs table
    await c.env.DB.prepare(`
      INSERT INTO usage_logs (
        user_id, model, provider, tokens, metadata, created_at
      ) VALUES (?, ?, 'comet', ?, ?, datetime('now'))
    `).bind(userId, model, totalTokens, JSON.stringify(usage)).run();
    
    // Update user's cumulative token usage
    await c.env.DB.prepare(`
      UPDATE users 
      SET tokens_used = tokens_used + ?, updated_at = datetime('now')
      WHERE clerk_id = ?
    `).bind(totalTokens, userId).run();
  }
}
```

### 2. WebSocket Realtime API Usage Tracking

Location: `src/routes/realtime-relay.ts`

```typescript
// Tracks usage from specific realtime events
realtimeClient.realtime.on('server.*', async (event: any) => {
  const eventsWithUsage = [
    'response.done',
    'conversation.item.input_audio_transcription.completed'
  ];
  
  if (eventsWithUsage.includes(event.type)) {
    let usage = null;
    
    // Extract usage based on event type
    if (event.type === 'response.done' && event.response?.usage) {
      usage = event.response.usage;
    } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.usage) {
      usage = event.usage;
    }
    
    if (usage) {
      // Insert detailed usage log
      await env.DB.prepare(`
        INSERT INTO usage_logs (
          user_id, event_type, event_id, session_id, model, provider,
          total_tokens, input_tokens, output_tokens,
          input_token_details, output_token_details, usage_data, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...).run();
      
      // Update cumulative usage
      await env.DB.prepare(`
        UPDATE users 
        SET tokens_used = tokens_used + ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(usage.total_tokens || 0, user.id).run();
    }
  }
});
```

## Database Schema and Fields

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  clerk_id TEXT UNIQUE NOT NULL,        -- Clerk user ID
  email TEXT NOT NULL,
  subscription TEXT DEFAULT 'fallback',  -- Current plan
  token_quota INTEGER DEFAULT 0,         -- Max tokens for plan
  tokens_used INTEGER DEFAULT 0,         -- DEPRECATED: Use usage_logs
  created_at DATETIME,
  updated_at DATETIME
);
```

### Usage Logs Table
```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,              -- FK to users.id
  event_type TEXT NOT NULL,              -- API event type
  model TEXT NOT NULL,                   -- AI model used
  provider TEXT NOT NULL,                -- 'openai', 'comet'
  total_tokens INTEGER NOT NULL,         -- Total tokens consumed
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  input_token_details TEXT,              -- JSON breakdown
  output_token_details TEXT,             -- JSON breakdown
  usage_data TEXT,                       -- Complete usage JSON
  metadata TEXT,                         -- Additional context
  created_at DATETIME
);
```

### Webhook Logs Table
```sql
CREATE TABLE webhook_logs (
  id INTEGER PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,         -- For idempotency
  event_type TEXT NOT NULL,              -- Clerk event type
  clerk_user_id TEXT,                    -- User affected
  raw_payload TEXT NOT NULL,             -- Complete event JSON
  processing_status TEXT,                -- 'pending', 'success', 'failed'
  error_message TEXT,
  created_at DATETIME,
  processed_at DATETIME
);
```

## Quota Calculation Logic

### Real-time Quota Calculation

Location: `src/routes/usage.ts:16`

```typescript
app.get('/quota', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  // Get user's plan quota
  const user = await c.env.DB.prepare(
    'SELECT id, token_quota FROM users WHERE clerk_id = ?'
  ).bind(userId).first();
  
  // Calculate current month's usage from usage_logs
  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
  
  const usageResult = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(total_tokens), 0) as used
    FROM usage_logs 
    WHERE user_id = ? AND created_at >= ?
  `).bind(user.id, currentMonth).first();
  
  const tokensUsed = usageResult?.used || 0;
  
  return {
    total: user.token_quota,           // Plan limit
    used: tokensUsed,                   // Current month usage
    remaining: user.token_quota === -1 ? -1 : 
               Math.max(0, user.token_quota - tokensUsed),
    resetDate: // First day of next month
  };
});
```

### Key Points:
1. **Monthly Reset**: Usage resets on the 1st of each month
2. **Real-time Calculation**: Usage is summed from `usage_logs` table on each request
3. **Unlimited Plans**: `token_quota = -1` indicates unlimited usage
4. **No Caching**: Each quota check queries the database for accuracy

## Plan Quota Mapping

```typescript
function getQuotaForPlan(plan: string): number {
  const quotas = {
    fallback: 0,
    free_plan: 0,               // 0 tokens
    starter_plan: 10_000_000,   // 10M tokens
    essentials_plan: 50_000_000, // 50M tokens
    enterprise_plan: -1          // Unlimited
  };
  return quotas[plan] || quotas.fallback;
}
```

## Data Flow Summary

1. **User Creation/Update Flow**:
   - Clerk webhook → Verify signature → Log event → Create/Update user → Set quota → Update KV

2. **Subscription Change Flow**:
   - Clerk webhook → Extract plan details → Update user quota → Preserve/Reset usage → Update KV

3. **Token Usage Flow**:
   - API call → Proxy/Relay → Extract usage from response → Log to usage_logs → Update cumulative usage

4. **Quota Check Flow**:
   - Client request → Get user quota → Sum usage_logs for current month → Calculate remaining → Return quota

## Important Implementation Details

1. **Idempotency**: Event IDs prevent duplicate processing
2. **Self-healing**: `ensureUserExists` syncs missing users from Clerk
3. **Race Condition Protection**: Uses `INSERT OR IGNORE` for concurrent operations
4. **Monthly Reset**: Usage calculations are scoped to current calendar month
5. **Real-time Accuracy**: No caching of usage data ensures accurate quota checks
6. **Webhook Logging**: All webhooks logged for debugging and audit trail
7. **Error Recovery**: Failed webhooks can be retried via admin endpoints