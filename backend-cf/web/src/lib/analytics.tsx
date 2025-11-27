/**
 * PostHog Analytics for backend-cf/web dashboard
 *
 * Provides analytics tracking for the account management dashboard.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { PostHog } from 'posthog-js-lite';

// PostHog configuration
const POSTHOG_KEY = 'phc_EMOuUDTntTI5SuzKQATy11qHgxVrlhJsgNFbBaWEhet';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// Analytics event types for the dashboard
export interface DashboardAnalyticsEvents {
  // Authentication events
  'dashboard_sign_in_attempted': { method: 'email' };
  'dashboard_sign_in_succeeded': { method: 'email' };
  'dashboard_sign_in_failed': { method: 'email'; error_type: string };
  'dashboard_sign_up_attempted': { method: 'email' };
  'dashboard_sign_up_succeeded': { method: 'email' };
  'dashboard_sign_up_failed': { method: 'email'; error_type: string };
  'dashboard_sign_out_clicked': Record<string, never>;

  // Password reset events
  'dashboard_password_reset_initiated': Record<string, never>;
  'dashboard_password_reset_email_sent': Record<string, never>;
  'dashboard_password_reset_succeeded': Record<string, never>;
  'dashboard_password_reset_failed': { error_type: string };

  // Dashboard navigation
  'dashboard_page_viewed': { page: 'home' | 'profile' | 'security' };

  // Profile events
  'dashboard_profile_updated': { fields_updated: string[] };
  'dashboard_avatar_changed': Record<string, never>;

  // Security events
  'dashboard_session_revoked': { session_id: string };
  'dashboard_all_sessions_revoked': Record<string, never>;
  'dashboard_password_changed': Record<string, never>;
  'dashboard_email_changed': Record<string, never>;
  'dashboard_account_deleted': Record<string, never>;

  // Navigation events
  'dashboard_forgot_password_link_clicked': Record<string, never>;
  'dashboard_sign_up_link_clicked': Record<string, never>;
  'dashboard_sign_in_link_clicked': Record<string, never>;
}

// PostHog context
const PostHogContext = createContext<PostHog | null>(null);

// Hook to access PostHog instance
export function usePostHog() {
  return useContext(PostHogContext);
}

// PostHog Provider component
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [posthog, setPostHog] = useState<PostHog | null>(null);

  useEffect(() => {
    // Initialize PostHog
    const client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 1, // Send immediately
      flushInterval: 2000,
    });

    // Set super properties
    client.register({
      app_version: '1.0.0',
      platform: 'dashboard',
      environment: import.meta.env.DEV ? 'development' : 'production',
    });

    setPostHog(client);

    return () => {
      // Cleanup on unmount
      client.flush();
    };
  }, []);

  return (
    <PostHogContext.Provider value={posthog}>
      {children}
    </PostHogContext.Provider>
  );
}

// Custom hook for analytics with typed events
export function useAnalytics() {
  const posthog = usePostHog();

  const trackEvent = <T extends keyof DashboardAnalyticsEvents>(
    eventName: T,
    properties: DashboardAnalyticsEvents[T]
  ) => {
    try {
      if (posthog) {
        posthog.capture(eventName, properties as Record<string, any>);
      }
    } catch (error) {
      console.error('[Analytics] Tracking error:', error);
    }
  };

  /**
   * Identify a user with PostHog
   * @param userId - The user's unique ID
   * @param email - The user's email (stored as $email in PostHog)
   * @param traits - Additional user properties
   */
  const identifyUser = (userId: string, email?: string, traits?: Record<string, any>) => {
    try {
      if (posthog) {
        const properties: Record<string, any> = { ...traits };
        if (email) {
          properties.$email = email;
        }
        posthog.identify(userId, properties);
      }
    } catch (error) {
      console.error('[Analytics] Identify error:', error);
    }
  };

  const resetUser = () => {
    try {
      if (posthog) {
        posthog.reset();
      }
    } catch (error) {
      console.error('[Analytics] Reset error:', error);
    }
  };

  return {
    trackEvent,
    identifyUser,
    resetUser,
  };
}
