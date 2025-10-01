import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { withCloudflare } from "better-auth-cloudflare";
import { createDb } from "./db";
import type { CloudflareBindings } from "./env";
import * as schema from "./db/schema";

export function createAuth(env: CloudflareBindings, cf?: IncomingRequestCfProperties) {
  const db = createDb(env);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL || "http://localhost:8787",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // Set to true in production with email provider
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    advanced: {
      useSecureCookies: env.ENVIRONMENT === "production",
      crossSubDomainCookies: {
        enabled: true,
      },
      // generateId: false, // Let better-auth generate IDs
    },
    trustedOrigins: [
      env.FRONTEND_URL || "http://localhost:5173",
      "http://localhost:3000",
      "https://sokuji.kizuna.ai",
      "https://www.sokuji.kizuna.ai",
      "https://dev.sokuji.kizuna.ai",
    ],
    rateLimit: {
      enabled: true,
      window: 60, // 1 minute
      max: 100, // 100 requests per minute
    },
    // Use Cloudflare-specific features (commented out until better-auth-cloudflare is properly configured)
    // Note: withCloudflare needs to be properly integrated
    // For now, we'll use basic better-auth features
  });
}

export type Auth = ReturnType<typeof createAuth>;
