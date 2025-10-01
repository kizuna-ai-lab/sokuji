# Sokuji Backend - Better Auth + Cloudflare Workers

Modern authentication backend for Sokuji using better-auth, Cloudflare Workers, D1 database, and KV storage.

## Features

- ✅ **Better Auth Integration**: Native better-auth with email/password authentication
- ✅ **Drizzle ORM**: Type-safe database operations with migrations
- ✅ **Cloudflare Workers**: Serverless deployment with edge computing
- ✅ **D1 Database**: Serverless SQLite database
- ✅ **KV Storage**: Fast key-value storage for sessions
- ✅ **Wallet System**: Token-based billing and usage tracking
- ✅ **Type Safety**: Full TypeScript support with proper types

## Architecture

```
backend/
├── src/
│   ├── index.ts          # Main Hono app
│   ├── auth.ts           # Better auth configuration
│   ├── env.d.ts          # TypeScript environment definitions
│   ├── db/
│   │   ├── schema.ts     # Drizzle schema (better-auth + app tables)
│   │   └── index.ts      # DB initialization
│   ├── routes/
│   │   ├── user.ts       # User management routes
│   │   ├── wallet.ts     # Wallet management routes
│   │   └── health.ts     # Health check routes
│   └── lib/
│       └── utils.ts      # Utility functions
├── drizzle/              # Migration files directory
├── package.json
├── tsconfig.json
├── wrangler.toml         # Production config
├── wrangler.dev.toml     # Development config
└── drizzle.config.ts     # Drizzle ORM config
```

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and add your configuration:

```env
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:8787"  # Required: Base URL for auth service
FRONTEND_URL="http://localhost:5173"
ENVIRONMENT="development"
```

**Note:** `BETTER_AUTH_URL` is required because `crossSubDomainCookies` is enabled in the auth configuration.

### 3. Generate Database Migrations

```bash
npm run db:generate
```

This will create migration files in the `drizzle/` directory based on your schema.

### 4. Apply Migrations

For local development:
```bash
npm run db:migrate:dev
```

For production:
```bash
npm run db:migrate:prod
```

### 5. Run Development Server

```bash
npm run dev
```

The server will start at `http://localhost:8787`

## Development

### Available Scripts

- `npm run dev` - Start local development server
- `npm run dev:remote` - Start development server with remote bindings
- `npm run build` - Type check the project
- `npm run deploy` - Deploy to production
- `npm run deploy:dev` - Deploy to development environment
- `npm run cf-typegen` - Generate Cloudflare types
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:migrate:dev` - Apply migrations to local D1
- `npm run db:migrate:prod` - Apply migrations to production D1
- `npm run db:studio:dev` - Open Drizzle Studio for local database
- `npm run db:studio:prod` - Open Drizzle Studio for production database

### Database Schema

The schema includes:

1. **Better Auth Tables**: `user`, `session`, `account`, `verification`
2. **Application Tables**: `app_user`, `plans`, `wallets`, `wallet_ledger`, `entitlements`, `usage_logs`, `webhook_logs`

### API Endpoints

#### Authentication Routes (Better Auth)
- `POST /api/auth/sign-up` - Sign up with email/password
- `POST /api/auth/sign-in/email` - Sign in with email/password
- `POST /api/auth/sign-out` - Sign out
- `GET /api/auth/session` - Get current session

#### User Routes
- `GET /api/user/profile` - Get user profile
- `GET /api/user/api-key` - Get API key (wallet-based)

#### Wallet Routes
- `GET /api/wallet/balance` - Get wallet balance
- `GET /api/wallet/usage` - Get usage history
- `GET /api/wallet/ledger` - Get ledger history
- `POST /api/wallet/mint` - Mint tokens (admin)

#### Health Routes
- `GET /api/health` - Basic health check
- `GET /api/health/db` - Database health check
- `GET /api/health/kv` - KV health check

## Database Management

### Viewing the Database

Use Drizzle Studio to view and edit your database:

```bash
npm run db:studio:dev  # For local D1
npm run db:studio:prod # For production D1
```

### Creating Migrations

1. Update your schema in `src/db/schema.ts`
2. Generate migrations: `npm run db:generate`
3. Review the generated SQL in `drizzle/`
4. Apply migrations: `npm run db:migrate:dev`

## Deployment

### Development Environment

```bash
npm run deploy:dev
```

### Production Environment

```bash
npm run deploy
```

## Configuration

### wrangler.toml

Production configuration with:
- D1 database binding
- KV namespace binding
- Custom routes for your domain
- Environment variables

### wrangler.dev.toml

Development configuration with:
- Local D1 database
- Local KV namespace
- Development environment variables

## Authentication Flow

1. User signs up with email/password via `POST /api/auth/sign-up`
2. Better auth creates user in `user` table and session in `session` table
3. Backend creates corresponding `app_user`, `wallet`, and `entitlement` records
4. User can sign in via `POST /api/auth/sign-in/email`
5. Session cookie is set and can be used for authenticated requests
6. API key is provided via `GET /api/user/api-key` (wallet-based access)

## Wallet System

The wallet system tracks token usage and billing:

1. **Wallets**: Each user has a wallet with token balance
2. **Ledger**: All token mints, uses, and refunds are recorded
3. **Usage Logs**: Detailed logs of API usage with pricing adjustments
4. **Entitlements**: Plan-based feature access and rate limits

## Migration from backend-cf

Key differences from the old `backend-cf/`:

1. ✅ Better Auth instead of custom auth implementation
2. ✅ Drizzle ORM with migrations instead of raw SQL
3. ✅ Cleaner code structure and separation of concerns
4. ✅ Type-safe database operations
5. ✅ Better developer experience with Drizzle Studio
6. ⚠️ No Durable Objects (can be added if needed for realtime)

## Troubleshooting

### Database Connection Issues

If you see database errors, ensure:
1. D1 database is created in Cloudflare dashboard
2. Database ID matches in `wrangler.toml`
3. Migrations have been applied

### Authentication Issues

If authentication fails:
1. Check `BETTER_AUTH_SECRET` is set
2. Verify `FRONTEND_URL` matches your frontend
3. Check CORS configuration in `src/index.ts`

### KV Issues

If KV operations fail:
1. Ensure KV namespace is created in Cloudflare dashboard
2. Check KV namespace ID in `wrangler.toml`

## License

MIT
