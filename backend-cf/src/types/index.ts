/**
 * Type definitions for the Cloudflare Workers backend
 */

/**
 * Hono context variables that are set by middleware
 * These are available in all route handlers after middleware runs
 */
export interface HonoVariables {
  userId?: string;
  userEmail?: string;
  subscription?: string;
}

export interface Env {
  // Bindings
  DB: D1Database;
  WALLET_CACHE: KVNamespace;
  REALTIME_RELAY: DurableObjectNamespace;
  
  // Environment variables
  ENVIRONMENT: 'development' | 'production';
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  OPENAI_API_KEY: string;
  COMET_API_KEY: string;
  FRONTEND_URL: string;
  EXTENSION_URL?: string;
  ADMIN_USER_IDS?: string;
}

export interface User {
  id: number;
  clerk_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
  subscription: 'free' | 'starter' | 'essentials' | 'professional' | 'business' | 'enterprise' | 'unlimited';
  created_at: string;
  updated_at: string;
}

// These interfaces are deprecated and replaced by the wallet system
// ApiKey, UsageLog, and Session are no longer used

export interface ClerkUser {
  id: string;
  email_addresses: Array<{
    email_address: string;
    id: string;
  }>;
  first_name?: string;
  last_name?: string;
  image_url?: string;
  public_metadata?: Record<string, any>;
  private_metadata?: Record<string, any>;
}

// QuotaInfo is deprecated - replaced by wallet system