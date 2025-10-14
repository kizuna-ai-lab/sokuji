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
                autoDetectIpAddress: true,
                geolocationTracking: true,
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
                    enabled: true,
                },
                plugins: [anonymous()],
                rateLimit: {
                    enabled: true,
                    storage: "secondary-storage", // Use secondary storage (KV with proper TTL handling)
                    window: 60, // 60 second window (matches Cloudflare KV minimum TTL)
                    max: 100, // Max 100 requests per window
                },
            }
        ),
        // Configure secondary storage for rate limiting with proper KV TTL handling
        secondaryStorage: env?.KV
            ? {
                  get: async (key: string) => {
                      const value = await env.KV.get(key);
                      return value;
                  },
                  set: async (key: string, value: string, ttl?: number) => {
                      // Cloudflare KV requires minimum TTL of 60 seconds
                      // If ttl is provided and less than 60, use 60 instead
                      const expirationTtl = ttl ? Math.max(ttl, 60) : 60;
                      await env.KV.put(key, value, { expirationTtl });
                  },
                  delete: async (key: string) => {
                      await env.KV.delete(key);
                  },
              }
            : undefined,
        // Only add database adapter for CLI schema generation
        ...(env
            ? {}
            : {
                  database: drizzleAdapter({} as D1Database, {
                      provider: "sqlite",
                      usePlural: true,
                      debugLogs: true
                  }),
              }),
    });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };
