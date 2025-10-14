# Better Auth Cloudflare Hono Example

This example demonstrates how to integrate [Better Auth](https://github.com/better-auth/better-auth) with [Hono](https://hono.dev/) on Cloudflare Workers using the `better-auth-cloudflare` plugin.

## Features

- 🚀 **Hono Framework**: Lightning-fast web framework for Cloudflare Workers
- 🗄️ **D1 Database Integration**: SQLite database via Cloudflare D1
- 🔌 **KV Storage Integration**: Session caching with proper TTL handling via Cloudflare KV
- 📍 **Automatic Geolocation Tracking**: Enriches sessions with location data
- 🌐 **Cloudflare IP Detection**: Automatic IP address detection
- 📧 **Email/Password Authentication**: User registration and login with password hashing
- 👤 **Anonymous Authentication**: Built-in anonymous user authentication
- 🔐 **Session Management**: Secure session handling with geolocation
- ⚡ **Rate Limiting**: KV-based rate limiting with 60s window (Cloudflare KV requirement)

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Cloudflare account with Workers and D1 enabled
- Wrangler CLI installed globally: `npm install -g wrangler`

### Installation

1. Navigate to this directory:

```bash
cd examples/hono
```

2. Install dependencies:

```bash
pnpm install
```

3. Configure your Cloudflare bindings in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DATABASE"
database_name = "your-database-name"
database_id = "your-database-id"

[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"
```

### Database Setup

1. Create a D1 database:

```bash
wrangler d1 create your-database-name
```

2. Update the `database_id` in `wrangler.toml` with the ID from the previous command.

3. Create a KV namespace:

```bash
wrangler kv:namespace create "KV"
```

4. Update the KV `id` in `wrangler.toml` with the ID from the previous command.

5. Apply database migrations:

```bash
pnpm run db:migrate:prod
```

### Deployment

Deploy to Cloudflare Workers:

```bash
pnpm run deploy
```

## Project Structure

```
src/
├── auth/
│   └── index.ts          # Better Auth configuration
├── db/
│   ├── index.ts          # Database exports
│   ├── schema.ts         # Combined schema
│   └── auth.schema.ts    # Generated auth schema
├── env.d.ts              # TypeScript environment types
└── index.ts              # Hono application

drizzle/                  # Database migrations
wrangler.toml            # Cloudflare Worker configuration
```

## Available Scripts

### Authentication Scripts

- `pnpm run auth:generate` - Generate auth schema from Better Auth config
- `pnpm run auth:format` - Format the generated auth schema
- `pnpm run auth:update` - Generate and format auth schema

### Database Scripts

- `pnpm run db:generate` - Generate new database migrations
- `pnpm run db:migrate:dev` - Apply migrations to local D1 database
- `pnpm run db:migrate:prod` - Apply migrations to production D1 database
- `pnpm run db:studio:dev` - Open Drizzle Studio for local database
- `pnpm run db:studio:prod` - Open Drizzle Studio for production database

### Development Scripts

- `pnpm run dev` - Start development server
- `pnpm run deploy` - Deploy to Cloudflare Workers
- `pnpm run cf-typegen` - Generate Cloudflare binding types

## Usage

### API Endpoints

- `GET /` - Demo page with email/password and anonymous authentication UI
- `GET /health` - Health check endpoint
- `GET /protected` - Protected route demo
- `ALL /api/auth/*` - All Better Auth routes (handled by better-auth)

#### Authentication Endpoints

**Email/Password Authentication:**
- `POST /api/auth/sign-up/email` - Register new user with email and password
  - Body: `{ name: string, email: string, password: string }`
- `POST /api/auth/sign-in/email` - Sign in with email and password
  - Body: `{ email: string, password: string, rememberMe?: boolean }`

**Anonymous Authentication:**
- `POST /api/auth/sign-in/anonymous` - Anonymous login (no credentials needed)

**Session Management:**
- `POST /api/auth/sign-out` - Sign out and clear session
- `GET /api/auth/get-session` - Get current session information
- `GET /api/auth/cloudflare/geolocation` - Get geolocation data for current session

### Authentication Methods

The demo page provides three authentication methods:

1. **Email/Password Sign Up**:
   - Create a new account with name, email, and password
   - Password must be at least 8 characters
   - Email must be unique

2. **Email/Password Sign In**:
   - Log in with existing credentials
   - Optional "Remember me" for extended sessions
   - Secure password hashing with Better Auth

3. **Anonymous Login**:
   - Quick access without creating an account
   - Ideal for temporary or demo usage
   - Can be linked to an email later

### Geolocation Tracking

When `geolocationTracking` is enabled, user sessions automatically include:

- `timezone` - User's timezone
- `city` - User's city
- `country` - User's country
- `region` - User's region/state
- `regionCode` - Region code
- `colo` - Cloudflare colo data center
- `latitude` & `longitude` - Coordinates

## Configuration

### Environment Variables

The application uses Cloudflare bindings defined in `wrangler.toml`:

```typescript
interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace;
}
```

### Better Auth Configuration

The auth configuration in `src/auth/index.ts` uses a simplified single-function approach that handles both CLI schema generation and runtime scenarios:

```typescript
import type { D1Database, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { anonymous } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "../db";
import type { CloudflareBindings } from "../env";

// Single auth configuration that handles both CLI and runtime scenarios
function createAuth(env?: CloudflareBindings, cf?: IncomingRequestCfProperties) {
    // Use actual DB for runtime, empty object for CLI
    const db = env ? drizzle(env.DATABASE, { schema, logger: true }) : ({} as any);

    return betterAuth({
        ...withCloudflare(
            {
                autoDetectIpAddress: true, // Auto-detect IP from Cloudflare headers
                geolocationTracking: true, // Track geolocation in sessions
                cf: cf || {},
                d1: env
                    ? {
                          db,
                          options: {
                              usePlural: true,
                              debugLogs: true,
                          },
                      }
                    : undefined,
                kv: env?.KV,
            },
            {
                emailAndPassword: {
                    enabled: true, // Enable email/password authentication
                },
                plugins: [anonymous()], // Enable anonymous authentication
                rateLimit: {
                    enabled: true,
                    storage: "secondary-storage", // Use KV with proper TTL handling
                    window: 60, // 60 second window (Cloudflare KV minimum)
                    max: 100, // Max 100 requests per window
                },
            }
        ),
        // Only add database adapter for CLI schema generation
        ...(env
            ? {}
            : {
                  database: drizzleAdapter({} as D1Database, {
                      provider: "sqlite",
                      usePlural: true,
                      debugLogs: true,
                  }),
              }),
    });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };
```

—
Powered by better-auth-cloudflare