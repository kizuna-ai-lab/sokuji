import type { D1Database, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { withCloudflare } from "better-auth-cloudflare";
import { anonymous, emailOTP, oneTimeToken } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "../db";
import type { CloudflareBindings } from "../env";
import { sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeConfirmation, sendOTPEmail } from "../lib/email";
import { getPostHogClient, trackServerEvent } from "../lib/posthog";

// Single auth configuration that handles both CLI and runtime scenarios
function createAuth(env?: CloudflareBindings, cf?: IncomingRequestCfProperties) {
    // Use actual DB for runtime, empty object for CLI
    const db = env ? drizzle(env.DATABASE, { schema, logger: true }) : ({} as any);

    // Email configuration from environment variables
    const emailConfig = env ? {
        user: env.ZOHO_MAIL_USER,
        password: env.ZOHO_MAIL_PASSWORD,
    } : { user: '', password: '' };

    // PostHog client for analytics (only in runtime, not CLI)
    const posthogApiKey = env?.POSTHOG_API_KEY;

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
                    requireEmailVerification: false, // Allow login without email verification, show warning in frontend
                    // Send password reset email
                    sendResetPassword: async ({ user, url, token }, request) => {
                        await sendPasswordResetEmail({
                            email: user.email,
                            resetUrl: url,
                        }, emailConfig);
                    },
                },
                // Email verification configuration
                emailVerification: {
                    sendVerificationEmail: async ({ user, url, token }, request) => {
                        await sendVerificationEmail({
                            email: user.email,
                            verificationUrl: url,
                        }, emailConfig);
                    },
                    sendOnSignUp: true, // Send verification email on sign up
                    autoSignInAfterVerification: true, // Auto sign in after verification
                },
                // User settings
                user: {
                    changeEmail: {
                        enabled: true,
                        sendChangeEmailConfirmation: async ({ user, newEmail, url, token }: any, request: any) => {
                            await sendEmailChangeConfirmation({
                                email: user.email,
                                newEmail,
                                confirmationUrl: url,
                            }, emailConfig);
                        },
                    },
                    deleteUser: {
                        enabled: true,
                    },
                },
                plugins: [
                    anonymous(),
                    emailOTP({
                        async sendVerificationOTP({ email, otp, type }) {
                            await sendOTPEmail({ email, otp, type }, emailConfig);
                        },
                        otpLength: 6,
                        expiresIn: 600, // 10 minutes
                    }),
                    oneTimeToken({
                        expiresIn: 180, // 3 minutes
                    }),
                ],
                // Add trustedOrigins to allow requests from frontend
                trustedOrigins: [
                    "http://localhost:5173",  // Vite dev server
                    "http://localhost:3000",  // Alternative dev port
                ],
                rateLimit: {
                    enabled: true,
                    storage: "secondary-storage", // Use secondary storage (KV with proper TTL handling)
                    window: 60, // 60 second window (matches Cloudflare KV minimum TTL)
                    max: 100, // Max 100 requests per window
                    customRules: {
                        // Verification email: max 3 requests per 30 minutes (1800 seconds)
                        "/send-verification-email": {
                            window: 1800,
                            max: 3,
                        },
                        // Password reset: max 3 requests per 30 minutes
                        "/forget-password": {
                            window: 1800,
                            max: 3,
                        },
                    },
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
        // Hooks for handling one-time token verification cookie setting
        hooks: {
            after: createAuthMiddleware(async (ctx) => {
                // When OTT verification succeeds, set the session cookie
                // This is needed because verifyOneTimeToken doesn't automatically set cookies
                // See: https://github.com/better-auth/better-auth/issues/3851
                if (ctx.path === "/one-time-token/verify") {
                    const session = (ctx.context as any).returned?.session;
                    if (session?.token) {
                        await ctx.setSignedCookie(
                            (ctx.context as any).authCookies.sessionToken.name,
                            session.token,
                            (ctx.context as any).secret,
                            {
                                maxAge: 7 * 24 * 60 * 60, // 7 days
                                httpOnly: true,
                                sameSite: "lax",
                                path: "/",
                            }
                        );
                    }
                }
            }),
        },
        // Database hooks for analytics tracking (only in runtime)
        ...(posthogApiKey
            ? {
                  databaseHooks: {
                      user: {
                          create: {
                              after: async (user: any) => {
                                  // Track new user sign up
                                  try {
                                      const client = getPostHogClient(posthogApiKey);
                                      await trackServerEvent(client, user.id, "server_sign_up_completed", {
                                          method: "email",
                                      });
                                  } catch (error) {
                                      console.error("[PostHog] Failed to track sign up:", error);
                                  }
                              },
                          },
                      },
                      session: {
                          create: {
                              after: async (session: any) => {
                                  // Track new session (sign in)
                                  try {
                                      const client = getPostHogClient(posthogApiKey);
                                      await trackServerEvent(client, session.userId, "server_session_created", {
                                          session_id: session.id,
                                      });
                                  } catch (error) {
                                      console.error("[PostHog] Failed to track session created:", error);
                                  }
                              },
                          },
                      },
                  },
              }
            : {}),
    });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };
