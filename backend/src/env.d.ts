export interface CloudflareBindings {
  DATABASE: D1Database;
  KV: KVNamespace;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  FRONTEND_URL?: string;
  ENVIRONMENT?: string;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends CloudflareBindings {}
  }
}
