# Sokuji Backend - Cloudflare Workers

A high-performance, serverless backend for the Sokuji AI translation service, built on Cloudflare Workers with integrated authentication, quota management, and real-time synchronization.

## 🏗️ Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐
│ Chrome Extension│     │  Electron App   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │  Cloudflare │
              │   Workers   │
              └──────┬──────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
   ┌───▼───┐   ┌────▼────┐   ┌───▼───┐
   │ Clerk │   │   D1    │   │  KV   │
   │ Auth &│   │Database │   │Storage│
   │ Subs  │   └─────────┘   └───────┘
   └───────┘
```

## ✨ Features

### Core Capabilities
- **🔐 Multi-Platform Authentication**: Unified auth for Chrome Extension and Electron app via Clerk
- **📊 Token Quota Management**: Per-user token tracking with 50M tokens for premium subscribers
- **💳 Subscription Management**: Managed through Clerk user metadata and dashboard
- **🔄 Quota Synchronization**: HTTP polling-based quota sync across devices
- **🔑 API Key Management**: Secure distribution of pre-created provider API keys
- **📈 Usage Analytics**: Detailed usage tracking by provider, model, and device
- **⚡ Edge Performance**: Global deployment on Cloudflare's edge network

### Security Features
- JWT-based authentication with Clerk
- API key masking and secure storage
- Rate limiting per subscription tier
- Webhook signature verification with Clerk/Svix
- CORS protection with origin validation

## 🛠️ Technology Stack

- **Runtime**: Cloudflare Workers (V8 Isolates)
- **Framework**: [Hono](https://hono.dev/) - Ultrafast web framework
- **Database**: Cloudflare D1 (SQLite at the edge)
- **KV Storage**: Cloudflare KV for session and quota caching
- **Session Management**: Cloudflare KV for device session tracking
- **Authentication**: [Clerk](https://clerk.com/)
- **Language**: TypeScript

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account with Workers enabled
- Clerk account for authentication and subscription management
- Wrangler CLI (`npm install -g wrangler`)
- Domain: kizuna.ai (with DNS management in Cloudflare)

### Automated Setup

Use the interactive setup script for quick environment configuration:

```bash
cd backend-cf
./scripts/setup-environments.sh
```

### Manual Installation

1. **Clone and install dependencies:**
```bash
cd backend-cf
npm install
```

2. **Create resources for each environment:**

**Development:**
```bash
wrangler d1 create sokuji-db-dev
wrangler kv namespace create "QUOTA_KV"
wrangler kv namespace create "SESSION_KV"
```

**Production:**
```bash
wrangler d1 create sokuji-db-prod
wrangler kv namespace create "QUOTA_KV"
wrangler kv namespace create "SESSION_KV"
```

3. **Initialize databases:**
```bash
# Development (local)
npm run db:init:dev

# Development (remote)
npm run db:init:dev:remote

# Production (remote)
npm run db:init:prod:remote
```

4. **Configure environment variables:**
```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your local development credentials
```

### Local Development

```bash
npm run dev
# Server runs at http://localhost:8787
```

### Deployment

```bash
# Deploy to development environment
npm run deploy:dev

# Deploy to production environment
npm run deploy:prod
```

## 📁 Project Structure

```
backend-cf/
├── src/
│   ├── index.ts              # Main application entry
│   ├── types/                # TypeScript type definitions
│   ├── middleware/           # Auth and validation middleware
│   ├── routes/               # API route handlers
│   │   ├── auth.ts          # Authentication endpoints
│   │   ├── health.ts        # Health check endpoints
│   │   ├── user.ts          # User management
│   │   ├── subscription.ts  # Subscription handling
│   │   └── usage.ts         # Usage tracking
│   └── services/            # External service integrations
│       └── clerk.ts         # Clerk auth service
├── scripts/
│   └── setup-environments.sh # Environment setup script
├── schema/
│   └── database.sql         # D1 database schema
├── wrangler.toml           # Production config
├── wrangler.dev.toml       # Development config
├── .dev.vars.example       # Local dev variables template
└── package.json
```

## 🗄️ Database Schema

### Tables

#### `users`
- User profiles synchronized from Clerk
- Stores subscription tier and token quotas
- Managed entirely through Clerk metadata

#### `api_keys`
- Manages API keys assigned to users
- Tracks provider, tier, and rate limits
- Soft delete for key revocation

#### `usage_logs`
- Detailed token usage records
- Tracks by provider, model, and device
- Used for analytics and billing


#### `sessions`
- Multi-device session tracking
- Platform identification (Chrome/Electron)
- Activity monitoring

## 🔌 API Endpoints

### Authentication (`/api/auth/*`)
- `GET /oauth/:provider` - OAuth flow initiation
- `POST /refresh` - Token refresh
- `POST /signout` - Session termination
- `POST /webhook/clerk` - Clerk webhook handler (subscriptions, sessions, users)

### User Management (`/api/user/*`)
- `GET /profile` - User profile with quota
- `PATCH /profile` - Update user details
- `GET /api-key` - Get/create Kizuna AI API key (backend-managed)

### Subscriptions (`/api/subscription/*`)
- `GET /plans` - Available subscription tiers
- `GET /current` - Current subscription status from Clerk metadata
- `POST /upgrade` - Instructions for upgrading through Clerk dashboard

### Usage Tracking (`/api/usage/*`)
- `GET /quota` - Current quota status
- `POST /report` - Report token usage
- `POST /sync` - Sync quota across devices (HTTP polling)
- `GET /sessions` - List active sessions/devices
- `GET /history` - Usage history
- `GET /stats` - Usage analytics

### Health Check (`/api/health/*`)
- `GET /` - System health and environment status
- `GET /ping` - Simple connectivity check

For detailed API documentation, see [API.md](./API.md).

## 🌍 Multi-Environment Configuration

### Environments

| Environment | API URL | Frontend URL | Config File |
|------------|---------|--------------|-------------|
| Local | http://localhost:8787 | http://localhost:5173 | .dev.vars |
| Development | https://sokuji-api-dev.kizuna.ai | https://dev.sokuji.kizuna.ai | wrangler.dev.toml |
| Production | https://sokuji-api.kizuna.ai | https://sokuji.kizuna.ai | wrangler.toml |

### Environment Variables

#### Required Variables

```bash
# Clerk Authentication
CLERK_SECRET_KEY=sk_test_... (dev) / sk_live_... (prod)
CLERK_PUBLISHABLE_KEY=pk_test_... (dev) / pk_live_... (prod)
CLERK_WEBHOOK_SECRET=whsec_...

# Cloudflare AI Gateway
AI_GATEWAY_ACCOUNT_ID=your_account_id
AI_GATEWAY_ID=your_gateway_id

# URLs (set per environment)
FRONTEND_URL=https://sokuji.kizuna.ai
EXTENSION_URL=chrome-extension://your-extension-id
ENVIRONMENT=development|production

# Database IDs (from wrangler commands)
# Set in wrangler.toml files after resource creation
```

#### Optional Variables

```bash
# AI Provider Keys (optional)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
COMET_API_KEY=...
PALABRA_API_KEY=...

# Admin
ADMIN_USER_IDS=user_id1,user_id2
```

## 🚢 Deployment

### Development Deployment

```bash
# Set secrets for development
wrangler secret put CLERK_SECRET_KEY --env dev
wrangler secret put CLERK_PUBLISHABLE_KEY --env dev
wrangler secret put CLERK_WEBHOOK_SECRET --env dev

# Deploy to development
npm run deploy:dev

# View logs
npm run logs:dev
```

### Production Deployment

```bash
# Set secrets for production
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_PUBLISHABLE_KEY
wrangler secret put CLERK_WEBHOOK_SECRET

# Deploy to production
npm run deploy:prod

# View logs
npm run logs:prod
```

### DNS Configuration

Add these CNAME records in Cloudflare for kizuna.ai:

```
# Development
sokuji-api-dev.kizuna.ai → [workers-dev-subdomain].workers.dev
dev.sokuji.kizuna.ai → [frontend-hosting]

# Production
sokuji-api.kizuna.ai → [workers-subdomain].workers.dev
sokuji.kizuna.ai → [frontend-hosting]
```

### Monitoring & Logs

```bash
# View real-time logs
npm run logs:dev  # Development logs
npm run logs:prod # Production logs

# View D1 database metrics
wrangler d1 insights sokuji-db-dev  # Development
wrangler d1 insights sokuji-db-prod # Production

# KV storage metrics
wrangler kv:namespace list
```

## 🔄 Quota Synchronization

The backend uses HTTP polling for quota synchronization across devices:

### Sync Flow
1. Client calls `/api/usage/sync` with auth token and last sync timestamp
2. Server returns current quota and hasUpdates flag
3. Client polls periodically (recommended: every 30 seconds when active)
4. Sessions tracked in KV storage with 24-hour TTL

### Sync Endpoint
- **POST** `/api/usage/sync` - Get latest quota and sync status
- **GET** `/api/usage/sessions` - Get all active sessions/devices
- **POST** `/api/usage/report` - Report token usage

## 🧪 Testing

### Local Testing
```bash
# Run local development server
npm run dev

# Test health check
curl http://localhost:8787/api/health

# Test with authentication
curl http://localhost:8787/api/user/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Development Environment Testing
```bash
# Test health check
curl https://sokuji-api-dev.kizuna.ai/api/health

# Test database operations
wrangler d1 execute sokuji-db-dev --command "SELECT * FROM users" --env dev

# Test KV operations
wrangler kv:key get --namespace-id=YOUR_DEV_KV_ID "quota:user_123"
```

### Production Environment Testing
```bash
# Test health check
curl https://sokuji-api.kizuna.ai/api/health

# Test database operations (be careful!)
wrangler d1 execute sokuji-db-prod --command "SELECT COUNT(*) FROM users"
```

## 📊 Subscription Tiers

| Plan | Monthly Tokens | API Keys | Concurrent Sessions | Price |
|------|---------------|----------|-------------------|-------|
| Free | 1M | 1 | 1 | $0 |
| Basic | 10M | 3 | 3 | $9.99 |
| Premium | 50M | 10 | 10 | $29.99 |
| Enterprise | Unlimited | Unlimited | Unlimited | Custom |

## 🔧 Maintenance

### Database Migrations
```bash
# Create migration
wrangler d1 migrations create sokuji-db-dev "migration_name" --env dev  # Development
wrangler d1 migrations create sokuji-db-prod "migration_name"            # Production

# Apply migrations
npm run db:migrate:dev  # Development
npm run db:migrate      # Production
```

### Backup & Recovery
```bash
# Export D1 database
wrangler d1 export sokuji-db-dev > backup-dev.sql    # Development
wrangler d1 export sokuji-db-prod > backup-prod.sql  # Production

# Import backup
wrangler d1 execute sokuji-db-dev --file=backup-dev.sql --env dev  # Development
wrangler d1 execute sokuji-db-prod --file=backup-prod.sql          # Production
```

### Monitoring Checklist
- [ ] API response times < 100ms p95
- [ ] Sync endpoint availability > 99.9%
- [ ] Database queries optimized
- [ ] KV cache hit rate > 90%
- [ ] Error rate < 0.1%

## 🐛 Troubleshooting

### Common Issues

**CORS Errors**
- Verify origin in `src/index.ts` CORS configuration
- Check Chrome Extension ID in manifest
- Ensure kizuna.ai domains are allowed

**Authentication Failures**
- Verify Clerk keys match environment (test vs live)
- Check JWT expiration settings
- Ensure webhook endpoints are accessible
- Verify authorized parties include all domain variants

**Quota Sync Issues**
- Check KV storage availability
- Verify sync endpoint authentication
- Monitor polling frequency in client
- Check session TTL in KV storage

**Database Connection**
- Ensure D1 database is created and bound
- Check database ID in wrangler.toml/wrangler.dev.toml
- Verify schema initialization with correct environment
- Use correct database name (sokuji-db-dev vs sokuji-db-prod)

**Environment Issues**
- Verify ENVIRONMENT variable is set correctly
- Check that secrets are set for the correct environment
- Ensure DNS records point to correct Workers subdomain
- Confirm Clerk webhook URLs match deployment environment

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

## 📄 License

This project is part of the Sokuji AI translation service.

## 🔗 Related Documentation

- [Multi-Environment Setup](./MULTI_ENV_SETUP.md) - Detailed environment configuration guide
- [AI Gateway Setup](./AI_GATEWAY_SETUP.md) - Cloudflare AI Gateway configuration
- [API Documentation](./API.md) - Detailed endpoint reference
- [Frontend Integration](../src/services/interfaces/) - Client service interfaces
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Hono Framework](https://hono.dev/)
- [Clerk Documentation](https://clerk.com/docs)
- [Clerk Webhooks](https://clerk.com/docs/webhooks/overview)