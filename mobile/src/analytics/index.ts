import { Platform } from 'react-native';
import PostHog from 'posthog-react-native';
import { sessionEndProperties, sessionStartProperties, type AnalyticsEvents } from './events';

export { sessionEndProperties, sessionStartProperties };

export const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';

// Created only when a key is configured (EXPO_PUBLIC_POSTHOG_KEY, and
// EXPO_PUBLIC_POSTHOG_HOST for a self-hosted instance); `platform` rides on
// every event as a super property, as the desktop's does.
const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
export const posthog: PostHog | null = key
  ? new PostHog(key, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com' })
  : null;
posthog?.register({ platform });

export function capture<K extends keyof AnalyticsEvents>(event: K, properties: AnalyticsEvents[K]): void {
  posthog?.capture(event, properties as unknown as Parameters<PostHog['capture']>[1]);
}
