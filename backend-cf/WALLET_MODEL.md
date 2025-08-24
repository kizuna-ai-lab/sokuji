# Wallet Model Documentation

## Overview

The Wallet Model is a token management system where tokens never expire and are minted proportionally based on actual payments received. This replaces the traditional subscription quota system.

## Core Principles

1. **Tokens Never Expire**: Once minted, tokens remain in the user's wallet indefinitely
2. **Proportional Minting**: Tokens are minted based on actual payment amount: `mint = floor(Q_new * clamp(A_now / P_new, 0, 1))`
3. **No Period Windows**: No monthly resets or complicated period tracking
4. **Anti-Gaming**: Natural protection against "upgrade gaming" since tokens are strictly proportional to payment

## Database Schema

### Tables

- **`plans`**: Plan definitions with monthly quota and pricing
- **`wallets`**: User token balances and frozen status
- **`wallet_ledger`**: Complete audit trail of all token movements
- **`entitlements`**: Current plan features and limits (separate from balance)
- **`processed_events`**: Webhook idempotency tracking

## Key Features

### Minting Rules

Tokens are ONLY minted when:
- Event type is `paymentAttempt.updated` or `payment.succeeded`
- Payment status is `paid` or `succeeded`
- Formula: `tokens = floor(monthly_quota * min(amount_paid / plan_price, 1))`
- Safety cap: Maximum 12 months of tokens per transaction

### Freezing Policy

Wallets can be frozen (balance preserved but unusable) when:
- Subscription status is `past_due` or `canceled`
- Refunds cause negative balance
- User account is deleted

### Atomic Operations

All token usage is atomic to prevent race conditions:
```sql
UPDATE wallets 
SET balance_tokens = balance_tokens - ? 
WHERE subject_type = ? AND subject_id = ?
  AND frozen = 0 
  AND balance_tokens >= ?
```

## API Endpoints

### Wallet Endpoints

- `GET /api/wallet/status` - Get current balance and entitlements
- `POST /api/wallet/use` - Deduct tokens from wallet
- `GET /api/wallet/history` - View transaction history
- `GET /api/wallet/quota` - Compatibility endpoint for old clients

### Response Format

```json
{
  "balance": 5000000,
  "frozen": false,
  "plan": "pro",
  "features": ["advanced_models", "api_access"],
  "rateLimitRpm": 300,
  "maxConcurrentSessions": 5
}
```

## Webhook Processing

### Payment Events (Mint Tokens)
- `paymentAttempt.updated` with status `paid`
- `payment.succeeded`

### Refund Events (Deduct Tokens)
- `payment.refunded`
- `refund.created`

### Subscription Events (Update Entitlements Only)
- `subscription.created/updated` - Updates plan features, NOT balance
- `subscription.deleted` - Freezes wallet

## Migration Guide

### From Quota System to Wallet Model

1. **Deploy Database Schema**
   ```bash
   wrangler d1 execute <DB_NAME> --file=schema/wallet-schema.sql
   ```

2. **Update Backend**
   ```bash
   ./deploy-wallet.sh
   ```

3. **Update Frontend**
   - Replace quota service calls with wallet service
   - Update UI to show balance instead of quota/usage

### Compatibility Mode

The system provides compatibility endpoints that map wallet operations to the old quota format:
- `/api/usage/quota` → `/api/wallet/quota`
- `total` = current balance
- `used` = 0 (not tracked in wallet model)
- `remaining` = balance (or 0 if frozen)

## Security Features

1. **Idempotency**: External event IDs prevent duplicate processing
2. **Timestamp Validation**: Rejects webhooks older than 5 minutes
3. **Negative Balance Protection**: Automatic freezing on negative balance
4. **Mint Capping**: Maximum 12 months of tokens per transaction
5. **Audit Trail**: Complete ledger of all token movements

## Plan Configuration

Plans are defined in the `plans` table:

| Plan | Monthly Tokens | Price |
|------|---------------|-------|
| free_plan | 0 | $0 |
| starter_plan | 10M | $10 |
| essentials_plan | 20M | $20 |
| pro_plan | 50M | $50 |
| business_plan | 100M | $100 |
| enterprise_plan | 500M | $500 |

## Testing

### Test Minting
```bash
# Simulate a payment webhook
curl -X POST https://your-worker.workers.dev/api/auth/webhook/clerk \
  -H "Content-Type: application/json" \
  -d '{
    "type": "paymentAttempt.updated",
    "data": {
      "status": "paid",
      "amount": 5000,
      "payer": {"user_id": "user_123"},
      "plan": {"slug": "pro_plan"}
    }
  }'
```

### Test Usage
```bash
# Use tokens
curl -X POST https://your-worker.workers.dev/api/wallet/use \
  -H "Authorization: Bearer <token>" \
  -d '{"tokens": 1000}'
```

## Monitoring

Monitor these key metrics:
1. Failed mint attempts (payment processing issues)
2. Frozen wallet rate (subscription issues)
3. Negative balance occurrences (refund handling)
4. Webhook processing latency
5. Token usage patterns

## Troubleshooting

### Common Issues

1. **Tokens not minting**: Check webhook event type and payment status
2. **Insufficient balance errors**: Check if wallet is frozen
3. **Duplicate webhook processing**: Check processed_events table
4. **Plan not updating**: Subscription events only update entitlements, not balance

### Debug Queries

```sql
-- Check user's wallet status
SELECT * FROM wallet_summary WHERE subject_id = 'user_xxx';

-- View recent transactions
SELECT * FROM wallet_ledger 
WHERE subject_id = 'user_xxx' 
ORDER BY created_at DESC LIMIT 10;

-- Check processed events
SELECT * FROM processed_events 
ORDER BY created_at DESC LIMIT 10;
```