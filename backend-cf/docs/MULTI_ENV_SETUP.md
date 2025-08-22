# Multi-Environment Setup Guide for Sokuji Backend

This guide covers the setup of three environments for the Sokuji backend on Cloudflare Workers using the kizuna.ai domain.

## Environment Overview

### 1. Local Development
- **API URL**: `http://localhost:8787`
- **Frontend URL**: `http://localhost:5173`
- **Config File**: `.dev.vars`
- **Database**: Local D1 (SQLite)
- **KV Storage**: Local in-memory

### 2. Cloudflare Development
- **API URL**: `https://sokuji-api-dev.kizuna.ai` or `https://dev.sokuji.kizuna.ai/api`
- **Frontend URL**: `https://dev.sokuji.kizuna.ai`
- **Config File**: `wrangler.dev.toml`
- **Database**: D1 Development instance
- **KV Storage**: Development namespaces

### 3. Cloudflare Production
- **API URL**: `https://sokuji-api.kizuna.ai` or `https://sokuji.kizuna.ai/api`
- **Frontend URL**: `https://sokuji.kizuna.ai`
- **Config File**: `wrangler.toml`
- **Database**: D1 Production instance
- **KV Storage**: Production namespaces

## Setup Instructions

### Step 1: Create Cloudflare Resources

#### Development Resources
```bash
# Create development D1 database
wrangler d1 create sokuji-db-dev

# Create development KV namespaces
wrangler kv namespace create "QUOTA_KV" --env dev
wrangler kv namespace create "SESSION_KV" --env dev

# Note the IDs returned and update wrangler.dev.toml
```

#### Production Resources
```bash
# Create production D1 database
wrangler d1 create sokuji-db-prod

# Create production KV namespaces
wrangler kv namespace create "QUOTA_KV"
wrangler kv namespace create "SESSION_KV"

# Note the IDs returned and update wrangler.toml
```

### Step 2: Initialize Databases

```bash
# Initialize development database
wrangler d1 execute sokuji-db-dev --file=schema/database.sql --env dev

# Initialize production database
wrangler d1 execute sokuji-db-prod --file=schema/database.sql
```

### Step 3: Configure Clerk for Multiple Environments

1. **Create two Clerk applications in your dashboard:**
   - Development: `sokuji-dev`
   - Production: `sokuji-prod`

2. **Configure webhook endpoints:**
   - Development: `https://sokuji-api-dev.kizuna.ai/api/auth/webhook/clerk`
   - Production: `https://sokuji-api.kizuna.ai/api/auth/webhook/clerk`

3. **Set allowed origins:**
   - Development:
     - `http://localhost:5173`
     - `https://dev.sokuji.kizuna.ai`
     - `chrome-extension://[DEV_EXTENSION_ID]`
   - Production:
     - `https://sokuji.kizuna.ai`
     - `chrome-extension://[PROD_EXTENSION_ID]`

### Step 4: Set Environment Secrets

#### Development Secrets
```bash
# Set development secrets
wrangler secret put CLERK_SECRET_KEY --env dev
wrangler secret put CLERK_PUBLISHABLE_KEY --env dev
wrangler secret put CLERK_WEBHOOK_SECRET --env dev

# Optional: AI provider keys
wrangler secret put OPENAI_API_KEY --env dev
wrangler secret put GEMINI_API_KEY --env dev
```

#### Production Secrets
```bash
# Set production secrets
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_PUBLISHABLE_KEY
wrangler secret put CLERK_WEBHOOK_SECRET

# Optional: AI provider keys
wrangler secret put OPENAI_API_KEY
wrangler secret put GEMINI_API_KEY
```

### Step 5: Configure Frontend Environment Variables

#### Development (.env.development)
```env
VITE_BACKEND_URL=https://sokuji-api-dev.kizuna.ai
VITE_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_DEV_KEY
VITE_ENVIRONMENT=development
```

#### Production (.env.production)
```env
VITE_BACKEND_URL=https://sokuji-api.kizuna.ai
VITE_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_PROD_KEY
VITE_ENVIRONMENT=production
```

### Step 6: Deploy to Environments

#### Deploy to Development
```bash
# Deploy using development configuration
wrangler deploy --env dev --config wrangler.dev.toml

# Or use npm script
npm run deploy:dev
```

#### Deploy to Production
```bash
# Deploy using production configuration
wrangler deploy

# Or use npm script
npm run deploy:prod
```

### Step 7: Configure DNS Records

Add the following DNS records in your Cloudflare dashboard for kizuna.ai:

#### Development Environment
```
Type: CNAME
Name: sokuji-api-dev
Target: YOUR_WORKERS_DEV_SUBDOMAIN.workers.dev

Type: CNAME
Name: dev.sokuji
Target: YOUR_FRONTEND_HOSTING
```

#### Production Environment
```
Type: CNAME
Name: sokuji-api
Target: YOUR_WORKERS_SUBDOMAIN.workers.dev

Type: CNAME
Name: sokuji
Target: YOUR_FRONTEND_HOSTING
```

## NPM Scripts

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "wrangler dev --env local",
    "dev:remote": "wrangler dev --env dev --config wrangler.dev.toml",
    "deploy:dev": "wrangler deploy --env dev --config wrangler.dev.toml",
    "deploy:prod": "wrangler deploy",
    "db:init:dev": "wrangler d1 execute sokuji-db-dev --file=schema/database.sql --env dev",
    "db:init:prod": "wrangler d1 execute sokuji-db-prod --file=schema/database.sql",
    "logs:dev": "wrangler tail --env dev",
    "logs:prod": "wrangler tail"
  }
}
```

## Environment-Specific Features

### Development Environment
- Debug logging enabled
- Relaxed CORS for localhost
- Test Clerk keys and webhooks
- Lower rate limits for testing
- Verbose error messages

### Production Environment
- Optimized logging
- Strict CORS policies
- Production Clerk keys
- Production rate limits
- Sanitized error messages

## Testing Different Environments

### Local Development
```bash
# Start local dev server
npm run dev

# Test endpoint
curl http://localhost:8787/api/health
```

### Cloudflare Development
```bash
# Deploy to dev
npm run deploy:dev

# Test endpoint
curl https://sokuji-api-dev.kizuna.ai/api/health
```

### Cloudflare Production
```bash
# Deploy to production
npm run deploy:prod

# Test endpoint
curl https://sokuji-api.kizuna.ai/api/health
```

## Monitoring and Debugging

### View Logs
```bash
# Development logs
wrangler tail --env dev

# Production logs
wrangler tail
```

### Database Queries
```bash
# Query development database
wrangler d1 execute sokuji-db-dev --command "SELECT * FROM users" --env dev

# Query production database
wrangler d1 execute sokuji-db-prod --command "SELECT * FROM users"
```

### KV Storage
```bash
# Development KV
wrangler kv:key list --namespace-id=YOUR_DEV_KV_ID

# Production KV
wrangler kv:key list --namespace-id=YOUR_PROD_KV_ID
```

## Rollback Procedures

### Development Rollback
```bash
# List deployments
wrangler deployments list --env dev

# Rollback to previous version
wrangler rollback --env dev [DEPLOYMENT_ID]
```

### Production Rollback
```bash
# List deployments
wrangler deployments list

# Rollback to previous version
wrangler rollback [DEPLOYMENT_ID]
```

## Security Considerations

1. **Never commit secrets** to version control
2. **Use different Clerk apps** for each environment
3. **Rotate secrets regularly** especially in production
4. **Monitor webhook endpoints** for unauthorized access
5. **Set up alerts** for unusual API usage patterns
6. **Use rate limiting** appropriate for each environment
7. **Enable Cloudflare security features** (WAF, DDoS protection)

## Troubleshooting

### Common Issues

#### CORS Errors
- Verify the FRONTEND_URL in wrangler configuration
- Check Clerk's allowed origins
- Ensure Chrome extension IDs are correct

#### Database Connection Issues
- Verify database IDs in wrangler.toml files
- Check if databases are initialized with schema
- Ensure bindings match in code

#### Webhook Failures
- Verify webhook secrets are set correctly
- Check webhook URLs in Clerk dashboard
- Monitor webhook logs in Clerk

#### Domain Resolution
- Verify DNS records are properly configured
- Check Cloudflare zone settings
- Ensure routes in wrangler.toml match DNS records

## Next Steps

1. Set up CI/CD pipelines for automated deployments
2. Configure monitoring and alerting
3. Implement automated testing for each environment
4. Set up database backup strategies
5. Create environment-specific feature flags