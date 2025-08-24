# Webhook Event Handling and Wallet-Based Token Management Documentation

## Overview

The Sokuji backend uses Clerk webhooks for user and subscription management, combined with a wallet-based token system where tokens never expire and are minted proportionally based on actual payments. This document explains how webhook events affect the wallet system and how token usage is tracked.

## Table of Contents
1. [Webhook Event Processing Pipeline](#webhook-event-processing-pipeline)
2. [Webhook Event Types and Their Impact](#webhook-event-types-and-their-impact)
3. [Wallet System Architecture](#wallet-system-architecture)
4. [Token Minting and Usage](#token-minting-and-usage)
5. [Database Schema and Fields](#database-schema-and-fields)
6. [Migration from Quota to Wallet](#migration-from-quota-to-wallet)

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
**Handler**: `handleUserCreated`
**Wallet Impact**:
- Creates new record in `users` table
- Initializes wallet with 0 balance
- Sets entitlements based on metadata

#### `user.updated`
**Handler**: `handleUserUpdated`
**Wallet Impact**:
- Updates user profile fields (email, name, image_url)
- No impact on wallet balance
- May update entitlements if plan changed

#### `user.deleted`
**Handler**: `handleUserDeleted`
**Wallet Impact**:
- Freezes wallet (balance preserved but unusable)
- User record marked as deleted

### Payment Events (Token Minting)

#### `paymentAttempt.updated`
**Handler**: `handlePaymentAttempt`
**Wallet Impact**:
- Triggers token minting when status is `paid`
- Mints tokens proportionally: `tokens = floor(monthly_quota * min(amount_paid / plan_price, 1))`
- Adds transaction to wallet_ledger
- Updates wallet balance atomically

#### `payment.succeeded`
**Handler**: `handlePaymentSucceeded`
**Wallet Impact**:
- Same as `paymentAttempt.updated` with status `paid`
- Ensures idempotency via external_id

### Refund Events

#### `payment.refunded` / `refund.created`
**Handler**: `handleRefund`
**Wallet Impact**:
- Deducts refunded tokens from wallet
- May freeze wallet if balance becomes negative
- Adds refund transaction to ledger

### Subscription Events (Entitlements Only)

#### `subscription.created`
**Handler**: `handleSubscriptionCreated`
**Wallet Impact**:
- Updates entitlements (features, rate limits)
- NO tokens minted (only payment events mint tokens)
- Sets plan features in entitlements table

#### `subscription.updated`
**Handler**: `handleSubscriptionUpdated`
**Wallet Impact**:
- Updates plan features and limits
- NO impact on wallet balance
- May change rate limits and concurrent sessions

#### `subscription.deleted`
**Handler**: `handleSubscriptionDeleted`
**Wallet Impact**:
- Freezes wallet (balance preserved)
- Downgrades entitlements to free tier
- Does NOT remove tokens from wallet

### Session Events

#### `session.created`, `session.pending`, `session.ended`
**Handlers**: `handleSessionCreated`, `handleSessionPending`, `handleSessionTerminated`
**Wallet Impact**:
- Triggers `ensureUserExists` to sync user from Clerk if missing
- Provides self-healing for missed `user.created` webhooks
- No direct impact on wallet balance

## Wallet System Architecture

### Core Principles

1. **Tokens Never Expire**: Once minted to a wallet, tokens remain until used
2. **Proportional Minting**: Tokens minted based on actual payment amount
3. **No Period Windows**: No monthly resets or complicated period tracking
4. **Anti-Gaming**: Natural protection against subscription manipulation

### Token Minting Formula

```
tokens_minted = floor(monthly_quota * min(amount_paid / plan_price, 1))
```

Example:
- Pro plan: 50M tokens/month at $50
- User pays $25 (50% of price)
- Mints: floor(50M * 0.5) = 25M tokens

### Wallet States

- **Active**: Normal operation, can use tokens
- **Frozen**: Balance preserved but cannot use tokens
  - Triggers: subscription canceled, past_due, refunds causing negative balance
- **Negative**: Automatic freezing, requires resolution

## Token Minting and Usage

### Token Minting (Payment Events)

```typescript
// Only on successful payment events
if (event.type === 'paymentAttempt.updated' && event.data.status === 'paid') {
  const amount = event.data.amount; // in cents
  const planPrice = getPlanPrice(event.data.plan.slug);
  const monthlyQuota = getPlanQuota(event.data.plan.slug);
  
  const tokensToMint = Math.floor(
    monthlyQuota * Math.min(amount / planPrice, 1)
  );
  
  // Atomic mint operation
  await walletService.mintTokens({
    subjectType: 'user',
    subjectId: userId,
    tokens: tokensToMint,
    externalId: event.data.id, // Idempotency key
    metadata: {
      plan: event.data.plan.slug,
      amount_paid: amount
    }
  });
}
```

### Token Usage (API Calls)

```typescript
// Atomic token deduction
const result = await walletService.useTokens({
  subjectType: 'user',
  subjectId: userId,
  tokens: totalTokens,
  metadata: {
    model: 'gpt-4',
    session_id: sessionId
  }
});

if (!result.success) {
  // Handle insufficient balance
  throw new Error('Insufficient tokens');
}
```

## Database Schema and Fields

### Wallets Table
```sql
CREATE TABLE wallets (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL,            -- 'user' or 'team'
  subject_id TEXT NOT NULL,               -- User or team ID
  balance_tokens INTEGER DEFAULT 0,      -- Current token balance
  frozen BOOLEAN DEFAULT 0,              -- Frozen state
  created_at DATETIME,
  updated_at DATETIME,
  UNIQUE(subject_type, subject_id)
);
```

### Wallet Ledger Table
```sql
CREATE TABLE wallet_ledger (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  type TEXT NOT NULL,                    -- 'mint', 'use', 'refund', 'adjust'
  tokens INTEGER NOT NULL,               -- Positive for mint, negative for use
  balance INTEGER NOT NULL,              -- Balance after transaction
  external_id TEXT,                      -- For idempotency
  metadata TEXT,                         -- JSON additional data
  created_at DATETIME,
  UNIQUE(external_id)                    -- Prevent duplicates
);
```

### Entitlements Table
```sql
CREATE TABLE entitlements (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  plan_id TEXT,                          -- Current plan
  features TEXT,                         -- JSON array of features
  rate_limit_rpm INTEGER DEFAULT 60,     -- Requests per minute
  max_concurrent_sessions INTEGER DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME,
  UNIQUE(subject_type, subject_id)
);
```

### Usage Logs Table (for 30-day statistics)
```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  created_at DATETIME
);
```

### Processed Events Table
```sql
CREATE TABLE processed_events (
  id INTEGER PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,      -- Payment/webhook event ID
  event_type TEXT NOT NULL,
  processed_at DATETIME
);
```

## Migration from Quota to Wallet

### Key Differences

| Aspect | Quota System | Wallet System |
|--------|--------------|---------------|
| Token Lifecycle | Reset monthly | Never expire |
| Token Source | Subscription tier | Actual payments |
| Usage Tracking | Monthly windows | Continuous deduction |
| Refund Handling | Complex adjustments | Simple deduction |
| Gaming Protection | Period manipulation possible | Naturally protected |

### Migration Steps

1. **Deploy Wallet Schema**
```bash
wrangler d1 execute sokuji-db --file=schema/wallet-schema.sql
```

2. **Update Backend Routes**
- All `/api/usage/*` endpoints have been removed
- Use `/api/wallet/*` endpoints exclusively
- Update webhook handlers for payment events
- Implement atomic wallet operations

3. **Frontend Updates**
- Update all API calls to use `/api/wallet/status`
- Update quota displays to show balance
- Add 30-day usage statistics
- Remove reset date displays

## Plan Configuration

| Plan | Monthly Tokens | Price |
|------|---------------|-------|
| free_plan | 0 | $0 |
| starter_plan | 10M | $10 |
| essentials_plan | 20M | $20 |
| pro_plan | 50M | $50 |
| business_plan | 100M | $100 |
| enterprise_plan | 500M | $500 |

## Data Flow Summary

1. **User Creation/Update Flow**:
   - Clerk webhook → Verify signature → Log event → Create/Update user → Initialize wallet

2. **Payment Flow (Token Minting)**:
   - Payment webhook → Verify payment → Calculate tokens → Mint to wallet → Add to ledger

3. **Token Usage Flow**:
   - API call → Check wallet balance → Atomic deduction → Log to usage_logs → Update ledger

4. **Balance Check Flow**:
   - Client request → Get wallet balance → Calculate 30-day usage → Return status

## Important Implementation Details

1. **Idempotency**: External IDs prevent duplicate token minting
2. **Atomic Operations**: All wallet operations are atomic to prevent race conditions
3. **Self-healing**: `ensureUserExists` syncs missing users from Clerk
4. **Proportional Minting**: Tokens strictly proportional to payment amount
5. **Frozen Wallets**: Balance preserved but unusable during subscription issues
6. **Audit Trail**: Complete ledger history for all token movements
7. **30-Day Statistics**: Rolling usage window for analytics
8. **Error Recovery**: Failed webhooks can be retried via admin endpoints
9. **Mint Capping**: Maximum 12 months of tokens per transaction for safety