export interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace;
    // Zoho Mail SMTP Configuration
    ZOHO_MAIL_USER: string;
    ZOHO_MAIL_PASSWORD: string;
    // PostHog Analytics
    POSTHOG_API_KEY: string;
    // Stripe Configuration
    STRIPE_PUBLISHABLE_KEY?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
}
