# Token Pricing System Documentation

## Overview

The token pricing system ensures profitability when proxying requests to various AI providers (OpenAI, CometAPI, etc.) by applying appropriate multipliers to input and output tokens based on actual provider costs.

## How It Works

### 1. Base Pricing
- **Our Price**: $10.00 per 1M tokens (flat rate for customers)
- **Profit Margin**: 20% (configurable via `PROFIT_MARGIN` constant in `pricing.ts`)

### 2. Token Adjustment Formula

```
Input Ratio = (Provider Input Cost / Our Price) × Profit Margin
Output Ratio = (Provider Output Cost / Our Price) × Profit Margin

Adjusted Input Tokens = Raw Input Tokens × Input Ratio (rounded up)
Adjusted Output Tokens = Raw Output Tokens × Output Ratio (rounded up)
Total Billed Tokens = Adjusted Input + Adjusted Output
```

### 3. Provider Cost Examples

| Model | Type | Input Cost/1M | Output Cost/1M | Input Ratio | Output Ratio |
|-------|------|---------------|----------------|-------------|--------------|
| gpt-4o-realtime | text | $5.00 | $20.00 | 0.6x | 2.4x |
| gpt-4o-realtime | audio | $40.00 | $80.00 | 4.8x | 9.6x |
| gpt-4o-mini-realtime | text | $0.60 | $2.40 | 0.072x | 0.288x |
| gpt-4o-mini-realtime | audio | $10.00 | $20.00 | 1.2x | 2.4x |

## Implementation Details

### Key Files

1. **`src/services/pricing.ts`**
   - Core pricing calculation service
   - Contains hardcoded provider costs and ratios
   - Configurable `PROFIT_MARGIN` constant

2. **`src/routes/proxy.ts`**
   - REST API proxy with pricing integration
   - Applies text modality pricing

3. **`src/routes/realtime-relay.ts`**
   - WebSocket relay with pricing integration
   - Determines modality (audio/text) based on model and event data

4. **`schema/add-pricing-columns.sql`**
   - Optional database migration to track adjusted tokens
   - Includes views for profitability analysis

## Configuration

### Adjusting Profit Margin

Edit the `PROFIT_MARGIN` constant in `src/services/pricing.ts`:

```typescript
const PROFIT_MARGIN = 1.2; // 1.2 = 20% profit margin
// Change to 1.3 for 30% margin, 1.5 for 50% margin, etc.
```

### Adding New Models

Add the model costs to `PROVIDER_COSTS` in `src/services/pricing.ts`:

```typescript
const PROVIDER_COSTS = {
  'new-provider': {
    'new-model': {
      'text': { input: 10.0, output: 30.0 },
      'audio': { input: 50.0, output: 100.0 }
    }
  }
};
```

## Billing Examples

### Example 1: Audio Request (gpt-4o-realtime)
- **Raw Usage**: 1,000 input tokens, 2,000 output tokens
- **Ratios**: Input 4.8x, Output 9.6x
- **Adjusted**: 4,800 input + 19,200 output = 24,000 total tokens
- **Customer Pays**: 24,000 tokens × $10/1M = $0.24
- **Our Cost**: (1,000 × $40 + 2,000 × $80) / 1M = $0.20
- **Profit**: $0.04 (20% margin)

### Example 2: Text Request (gpt-4o-mini-realtime)
- **Raw Usage**: 5,000 input tokens, 3,000 output tokens
- **Ratios**: Input 0.072x, Output 0.288x
- **Adjusted**: 360 input + 864 output = 1,224 total tokens
- **Customer Pays**: 1,224 tokens × $10/1M = $0.01224
- **Our Cost**: (5,000 × $0.60 + 3,000 × $2.40) / 1M = $0.0102
- **Profit**: $0.00204 (20% margin)

## Monitoring and Analysis

### Database Views (if migration applied)

1. **`usage_with_adjustments`**: Shows raw vs adjusted tokens for each request
2. **`daily_usage_summary`**: Daily aggregated usage by user/model
3. **`model_profitability`**: Profitability analysis by model/provider

### Query Examples

```sql
-- See today's usage with adjustments
SELECT * FROM usage_with_adjustments 
WHERE DATE(created_at) = DATE('now')
ORDER BY created_at DESC;

-- Check profitability by model
SELECT * FROM model_profitability;

-- Get user's adjusted token usage
SELECT 
  SUM(adjusted_total_tokens) as total_billed,
  SUM(total_tokens) as total_raw
FROM usage_logs
WHERE subject_id = 'user_xxx'
  AND created_at >= datetime('now', '-30 days');
```

## Testing

### Manual Testing

1. Make a request through the proxy
2. Check logs for pricing calculations
3. Verify wallet deduction matches adjusted tokens
4. Check database for stored pricing ratios

### Log Output Example

```
[Proxy] Token adjustment for billing: {
  userId: 'user_xxx',
  model: 'gpt-4o-realtime-preview',
  provider: 'comet',
  rawInput: 1000,
  rawOutput: 2000,
  adjustedInput: 4800,
  adjustedOutput: 19200,
  totalAdjusted: 24000,
  inputRatio: '4.800',
  outputRatio: '9.600'
}
```

## Future Enhancements

1. **Dynamic Pricing**: Load ratios from database instead of hardcoding
2. **Admin API**: Endpoints to adjust pricing without code changes
3. **Alerts**: Notify when margins drop below threshold
4. **A/B Testing**: Test different pricing strategies
5. **Provider Cost Updates**: Automated sync with provider pricing changes

## Troubleshooting

### Common Issues

1. **Unknown Model**: Falls back to 1:1 ratio (conservative approach)
2. **Modality Detection**: Defaults to 'audio' for realtime models
3. **Rounding**: Always rounds up to ensure no losses

### Debug Logging

Enable debug logging in the pricing service to see detailed calculations:
- Check console logs for pricing ratio calculations
- Monitor token adjustment logs in proxy/relay routes
- Review wallet deduction logs for final billed amounts