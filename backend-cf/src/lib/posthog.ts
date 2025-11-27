/**
 * PostHog Analytics for Cloudflare Workers
 *
 * Uses posthog-node with special configuration for Workers environment.
 * See: https://posthog.com/docs/libraries/cloudflare-workers
 */

import { PostHog } from "posthog-node";

// PostHog client instance (will be lazily initialized)
let posthogClient: PostHog | null = null;

/**
 * Get or create PostHog client instance
 * Configured for Cloudflare Workers with immediate flush
 */
export function getPostHogClient(apiKey: string): PostHog {
    if (!posthogClient) {
        posthogClient = new PostHog(apiKey, {
            host: "https://us.i.posthog.com",
            // Critical for Cloudflare Workers:
            // - flushAt: 1 - Send immediately without batching
            // - flushInterval: 0 - Don't wait for interval
            // This prevents data loss when Worker terminates
            flushAt: 1,
            flushInterval: 0,
        });
    }
    return posthogClient;
}

/**
 * Track a server-side event
 * Should be used with ctx.waitUntil() for proper async handling in Workers
 */
export async function trackServerEvent(
    client: PostHog,
    userId: string,
    eventName: string,
    properties?: Record<string, any>
): Promise<void> {
    client.capture({
        distinctId: userId,
        event: eventName,
        properties: {
            ...properties,
            source: "server",
            timestamp: new Date().toISOString(),
        },
    });

    // Flush immediately in Workers environment
    await client.flush();
}

/**
 * Server-side event types for authentication tracking
 */
export type ServerAuthEvent =
    | "server_sign_up_completed"
    | "server_sign_in_completed"
    | "server_email_verified"
    | "server_password_reset_completed"
    | "server_session_created"
    | "server_session_ended";

/**
 * Shutdown PostHog client gracefully
 */
export async function shutdownPostHog(): Promise<void> {
    if (posthogClient) {
        await posthogClient.shutdown();
        posthogClient = null;
    }
}
