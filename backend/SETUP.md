# Backend Setup Guide

## Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment
```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:
```env
BETTER_AUTH_SECRET="your-secret-key-minimum-32-characters"
BETTER_AUTH_URL="http://localhost:8787"  # Required for crossSubDomainCookies
FRONTEND_URL="http://localhost:5173"
ENVIRONMENT="development"
```

**Important:** `BETTER_AUTH_URL` is required when `crossSubDomainCookies` is enabled in Better Auth configuration.

### 3. Apply Migrations (Already Generated)

The migration file `drizzle/0000_tearful_alex_power.sql` has been pre-generated.

```bash
# Apply migration to local development database
npm run db:migrate:dev
```

### 4. Seed Database with Plans

```bash
# Add default subscription plans
npm run db:seed:dev
```

This adds 7 subscription plans: `free_plan`, `starter_plan`, `essentials_plan`, `pro_plan`, `business_plan`, `enterprise_plan`, `unlimited_plan`

### 5. Start Development Server
```bash
npm run dev
```

Server starts at: http://localhost:8787

## Next Steps

### Testing the API

1. **Health Check**
   ```bash
   curl http://localhost:8787/api/health
   ```

2. **Sign Up**
   ```bash
   curl -X POST http://localhost:8787/api/auth/sign-up \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"testpassword123","name":"Test User"}'
   ```

3. **Sign In**
   ```bash
   curl -X POST http://localhost:8787/api/auth/sign-in/email \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"testpassword123"}'
   ```

4. **Get Profile** (requires session cookie from sign-in)
   ```bash
   curl http://localhost:8787/api/user/profile \
     -H "Cookie: better-auth.session_token=YOUR_SESSION_TOKEN"
   ```

### Database Management

**View Database with Drizzle Studio:**
```bash
npm run db:studio:dev
```

Opens a web interface at http://localhost:4983

**Generate New Migrations:**
1. Update `src/db/schema.ts`
2. Run `npm run db:generate`
3. Review generated SQL in `drizzle/`
4. Apply with `npm run db:migrate:dev`

### Deployment

**Deploy to Cloudflare:**
```bash
# Development
npm run deploy:dev

# Production
npm run deploy
```

**Before deploying:**
1. Ensure D1 database exists in Cloudflare dashboard
2. Update `wrangler.toml` with correct database ID
3. Apply migrations to production: `npm run db:migrate:prod`

## Project Structure

```
backend/
├── src/
│   ├── index.ts           # Main Hono app
│   ├── auth.ts            # Better Auth config
│   ├── env.d.ts           # TypeScript types
│   ├── db/
│   │   ├── schema.ts      # Database schema
│   │   └── index.ts       # DB initialization
│   ├── routes/
│   │   ├── user.ts        # User endpoints
│   │   ├── wallet.ts      # Wallet endpoints
│   │   └── health.ts      # Health checks
│   └── lib/
│       └── utils.ts       # Helper functions
├── drizzle/               # Migration files
├── package.json
├── tsconfig.json
├── wrangler.toml          # Production config
└── wrangler.dev.toml      # Development config
```

## Troubleshooting

**"Database not found"**
- Run `npm run db:migrate:dev` to create local database

**"Type errors during build"**
- Run `npm run build` to check TypeScript errors
- Ensure all dependencies are installed

**"CORS errors from frontend"**
- Verify `FRONTEND_URL` in `.dev.vars`
- Check CORS config in `src/index.ts`

**"Session not found"**
- Check cookie is being sent with requests
- Verify `BETTER_AUTH_SECRET` is set correctly

## Key Features

✅ Better Auth with email/password
✅ Drizzle ORM with type safety
✅ D1 SQLite database
✅ KV storage for sessions
✅ Wallet system for billing
✅ Usage tracking
✅ Health check endpoints
✅ Full TypeScript support

## API Endpoints

### Authentication
- `POST /api/auth/sign-up` - Create account
- `POST /api/auth/sign-in/email` - Sign in
- `POST /api/auth/sign-out` - Sign out
- `GET /api/auth/session` - Get session

### User
- `GET /api/user/profile` - Get user profile
- `GET /api/user/api-key` - Get API key (requires wallet balance)

### Wallet
- `GET /api/wallet/balance` - Get token balance
- `GET /api/wallet/usage` - Get usage history
- `GET /api/wallet/ledger` - Get transaction history
- `POST /api/wallet/mint` - Mint tokens (admin)

### Health
- `GET /api/health` - Basic health check
- `GET /api/health/db` - Database connectivity
- `GET /api/health/kv` - KV storage check
