# Sokuji Backend - Cloudflare Workers

A simplified, high-performance serverless backend for the Sokuji AI translation service, built on Cloudflare Workers with Clerk authentication and relay-based usage tracking.

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
              │  (Simplified)│
              └──────┬──────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
   ┌───▼───┐   ┌────▼────┐   ┌───▼───┐
   │ Clerk │   │   D1    │   │Relay  │
   │ Auth  │   │Database │   │Server │
   │       │   │(2 tables)│  │       │
   └───────┘   └─────────┘   └───────┘
                     ▲
                     │ Direct writes
               ┌─────▼─────┐
               │usage_logs │
               │   table   │
               └───────────┘
```

## ✨ Features

### Core Capabilities
- **🔐 Multi-Platform Authentication**: Unified auth for Chrome Extension and Electron app via Clerk
- **📊 Simplified Token Quota Management**: Real-time quota calculation from usage_logs table
- **💳 Subscription Management**: Managed through Clerk user metadata and dashboard
- **📈 Relay-Based Usage Tracking**: Direct usage logging from relay server to database
- **⚡ Edge Performance**: Global deployment on Cloudflare's edge network

### Security Features
- JWT-based authentication with Clerk
- Rate limiting per subscription tier
- Webhook signature verification with Clerk/Svix
- CORS protection with origin validation

## 🛠️ Technology Stack

- **Runtime**: Cloudflare Workers (V8 Isolates)
- **Framework**: [Hono](https://hono.dev/) - Ultrafast web framework
- **Database**: Cloudflare D1 (SQLite at the edge)
- **KV Storage**: Cloudflare KV for minimal caching
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
wrangler kv namespace create "QUOTA_KV"  # Minimal caching only
```

**Production:**
```bash
wrangler d1 create sokuji-db-prod
wrangler kv namespace create "QUOTA_KV"  # Minimal caching only
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
│   │   ├── auth.ts          # Clerk webhook handlers only
│   │   ├── health.ts        # Health check endpoints
│   │   ├── user.ts          # User management
│   │   └── usage.ts         # Simplified usage tracking
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

#### `usage_logs`
- Real-time token usage records written by relay server
- Tracks session_id, response_id, model, and token details
- Used for quota calculation and analytics

**Removed tables**: `api_keys`, `sessions`, and `realtime_sessions` have been eliminated for simplified architecture

## 🔌 API Endpoints

### Authentication (`/api/auth/*`)
- `POST /webhook/clerk` - Clerk webhook handler (user management)

### User Management (`/api/user/*`)
- `GET /profile` - User profile with quota

### Usage Tracking (`/api/usage/*`) - **Ultra-Simplified**
- `GET /quota` - Current quota status (aggregated from usage_logs)

**Removed endpoints**: `/oauth`, `/refresh`, `/signout`, `/sync`, `/report`, `/history`, `/stats`, `/sessions`, `/check`, `/reset`, `/profile` (PATCH), entire `/subscription` module

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

# Monitor usage logs
wrangler d1 execute sokuji-db-prod --command "SELECT COUNT(*) as total_records FROM usage_logs"
```

## 🔄 Usage Tracking Architecture

The backend now uses a simplified relay-based approach:

### Tracking Flow
1. Relay server captures OpenAI Realtime API events (`session.created`, `response.done`)
2. Usage data is written directly to `usage_logs` table
3. Frontend calls `/api/usage/quota` to get real-time quota status
4. No manual usage reporting required from frontend

### Quota Endpoint
- **GET** `/api/usage/quota` - Real-time quota calculation from usage_logs

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

# Test quota calculation
curl https://sokuji-api-dev.kizuna.ai/api/usage/quota \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Production Environment Testing
```bash
# Test health check
curl https://sokuji-api.kizuna.ai/api/health

# Test database operations (be careful!)
wrangler d1 execute sokuji-db-prod --command "SELECT COUNT(*) FROM users"
```

## 📊 Subscription Tiers

| Plan | Monthly Tokens | Price |
|------|---------------|-------|
| Free | 1M | $0 |
| Basic | 10M | $9.99 |
| Premium | 50M | $29.99 |
| Enterprise | Unlimited | Custom |

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
- [ ] Quota endpoint availability > 99.9%
- [ ] Database queries optimized
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

**Quota Calculation Issues**
- Check usage_logs table data integrity
- Verify relay server is writing usage data
- Monitor /quota endpoint response times
- Ensure proper date range calculations for monthly quotas

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