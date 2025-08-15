# Cloudflare AI Gateway Setup Guide

This guide explains how to set up and manage Cloudflare AI Gateway for the Sokuji backend across different environments.

## What is Cloudflare AI Gateway?

Cloudflare AI Gateway acts as a proxy between your application and AI providers (OpenAI, Google, etc.), providing:
- **Rate Limiting**: Control API request rates
- **Caching**: Cache responses to reduce costs
- **Analytics**: Monitor usage and performance
- **Fallback**: Automatic failover between providers
- **Security**: Hide API keys from client-side code

## Setup Instructions

### Step 1: Access AI Gateway Dashboard

1. Log in to your Cloudflare dashboard
2. Navigate to **AI Gateway** section: https://dash.cloudflare.com/ai-gateway
3. Click **Create Gateway**

### Step 2: Create Gateways for Each Environment

You need separate gateways for development and production:

#### Development Gateway
- **Name**: `sokuji-gateway-dev`
- **Description**: Development environment for Sokuji AI translation
- **Rate Limiting**: Higher limits for testing (e.g., 1000 requests/minute)
- **Caching**: Shorter TTL (5 minutes) for development

#### Production Gateway
- **Name**: `sokuji-gateway-prod`
- **Description**: Production environment for Sokuji AI translation
- **Rate Limiting**: Conservative limits (e.g., 100 requests/minute per user)
- **Caching**: Longer TTL (30 minutes) to reduce costs

### Step 3: Configure Gateway Settings

For each gateway, configure:

#### Rate Limiting
```json
{
  "requests_per_minute": 100,
  "requests_per_hour": 5000,
  "requests_per_day": 100000
}
```

#### Caching Rules
```json
{
  "cache_responses": true,
  "ttl_seconds": 1800,
  "cache_key_headers": ["Authorization", "X-User-Id"]
}
```

#### Provider Configuration
```json
{
  "providers": [
    {
      "name": "openai",
      "endpoint": "https://api.openai.com/v1",
      "priority": 1
    },
    {
      "name": "google-gemini",
      "endpoint": "https://generativelanguage.googleapis.com",
      "priority": 2
    }
  ]
}
```

### Step 4: Get Gateway IDs

After creating each gateway:
1. Click on the gateway name
2. Copy the **Gateway ID** (format: `abc123def456`)
3. Note down for configuration

### Step 5: Update Wrangler Configuration

#### Development (wrangler.dev.toml)
```toml
[vars]
AI_GATEWAY_ACCOUNT_ID = "your-account-id"
AI_GATEWAY_ID = "your-dev-gateway-id"
```

#### Production (wrangler.toml)
```toml
[vars]
AI_GATEWAY_ACCOUNT_ID = "your-account-id"
AI_GATEWAY_ID = "your-prod-gateway-id"
```

### Step 6: Use AI Gateway in Code

The backend uses AI Gateway through environment variables:

```typescript
// Example usage in your code
const AI_GATEWAY_URL = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}`;

// OpenAI through AI Gateway
const openaiUrl = `${AI_GATEWAY_URL}/openai/chat/completions`;

// Google Gemini through AI Gateway
const geminiUrl = `${AI_GATEWAY_URL}/google-ai/gemini/v1/models`;
```

## Environment Variables

### Required Variables
```bash
# Cloudflare Account ID (same for all environments)
AI_GATEWAY_ACCOUNT_ID=567d673242fea0196daf20a8aa2f92ec

# Gateway IDs (different per environment)
AI_GATEWAY_ID=your-gateway-id  # Specific to each environment
```

### Setting Variables

#### For Local Development (.dev.vars)
```bash
AI_GATEWAY_ACCOUNT_ID=567d673242fea0196daf20a8aa2f92ec
AI_GATEWAY_ID=dev-gateway-id
```

#### For Cloudflare Deployment
```bash
# Development
wrangler secret put AI_GATEWAY_ID --env dev
# Enter: your-dev-gateway-id

# Production
wrangler secret put AI_GATEWAY_ID
# Enter: your-prod-gateway-id
```

## Testing AI Gateway

### Test Gateway Connection
```bash
# Test development gateway
curl -X POST https://gateway.ai.cloudflare.com/v1/YOUR_ACCOUNT_ID/YOUR_DEV_GATEWAY_ID/openai/chat/completions \
  -H "Authorization: Bearer YOUR_OPENAI_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Test production gateway
curl -X POST https://gateway.ai.cloudflare.com/v1/YOUR_ACCOUNT_ID/YOUR_PROD_GATEWAY_ID/openai/chat/completions \
  -H "Authorization: Bearer YOUR_OPENAI_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Monitor Usage
1. Go to AI Gateway dashboard
2. Select your gateway
3. View analytics:
   - Request count
   - Cache hit rate
   - Error rate
   - Latency metrics

## Best Practices

### 1. Separate Environments
- Always use different gateways for dev and prod
- Test rate limits in development first
- Monitor costs closely in production

### 2. Caching Strategy
- Cache non-personalized responses longer
- Use request headers as cache keys wisely
- Monitor cache hit rates

### 3. Rate Limiting
- Set conservative limits initially
- Increase based on actual usage patterns
- Implement client-side retry logic

### 4. Error Handling
- Handle gateway errors gracefully
- Implement fallback to direct API calls if needed
- Log gateway errors for monitoring

### 5. Security
- Never expose gateway IDs in client code
- Use environment variables for configuration
- Rotate API keys regularly

## Troubleshooting

### Common Issues

#### Gateway Not Found
- Verify Gateway ID is correct
- Check Account ID matches your Cloudflare account
- Ensure gateway is active in dashboard

#### Rate Limit Exceeded
- Check current rate limit settings
- Implement exponential backoff
- Consider upgrading limits

#### Cache Not Working
- Verify cache settings are enabled
- Check cache key configuration
- Monitor cache hit rates in dashboard

#### Authentication Errors
- Verify API keys are correct
- Check provider configuration
- Ensure proper authorization headers

## Cost Management

### Monitor Usage
- Set up usage alerts in Cloudflare
- Review analytics weekly
- Track per-provider costs

### Optimize Caching
- Increase cache TTL for stable responses
- Use appropriate cache keys
- Monitor cache effectiveness

### Rate Limiting
- Implement per-user limits
- Use token buckets for fair usage
- Consider subscription tiers

## Migration from Direct API Calls

If migrating from direct API calls to AI Gateway:

1. **Update API Endpoints**
   - Replace `https://api.openai.com` with gateway URL
   - Update all provider endpoints

2. **Test Thoroughly**
   - Verify responses match expected format
   - Test rate limiting behavior
   - Check caching effectiveness

3. **Monitor Performance**
   - Compare latency with direct calls
   - Track error rates
   - Monitor cost savings

## Additional Resources

- [Cloudflare AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [Rate Limiting Best Practices](https://developers.cloudflare.com/ai-gateway/configuration/rate-limiting/)
- [Caching Configuration](https://developers.cloudflare.com/ai-gateway/configuration/caching/)
- [Analytics and Monitoring](https://developers.cloudflare.com/ai-gateway/analytics/)

## Support

For issues with AI Gateway:
1. Check Cloudflare status page
2. Review gateway logs in dashboard
3. Contact Cloudflare support if needed