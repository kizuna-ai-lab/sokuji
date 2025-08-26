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
  QUOTA_KV: KVNamespace;
  SESSION_KV: KVNamespace;
  
  // Environment variables
  ENVIRONMENT: 'development' | 'production';
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  OPENAI_API_KEY: string;
  COMET_API_KEY: string;
  FRONTEND_URL: string;
  EXTENSION_URL?: string;
}

export interface User {
  id: number;
  clerk_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
  subscription: 'free' | 'starter' | 'essentials' | 'professional' | 'business' | 'enterprise' | 'unlimited';
  token_quota: number;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: number;
  user_id: number;
  key: string;
  name?: string;
  provider: 'openai' | 'gemini' | 'comet' | 'palabra';
  provider_key?: string;
  tier: string;
  rate_limit: number;
  is_active: boolean;
  created_at: string;
  last_used_at?: string;
}

export interface UsageLog {
  id: number;
  user_id: number;
  api_key_id?: number;
  tokens: number;
  model?: string;
  provider?: string;
  cost?: number;
  metadata?: string;
  created_at: string;
}

// Subscription interface is no longer needed - subscription data is stored in Clerk metadata

export interface Session {
  id: number;
  user_id: number;
  device_id: string;
  platform: 'electron' | 'extension';
  last_active: string;
  metadata?: string;
}

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

export interface QuotaInfo {
  userId: string;
  total: number;
  used: number;
  remaining: number;
  resetDate: string;
  devices?: Array<{
    deviceId: string;
    platform: string;
    tokensUsed: number;
    lastActive: string;
  }>;
}