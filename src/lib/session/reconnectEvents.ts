/**
 * The three reconnect analytics events (spec §4.5), defined once so the mobile
 * app, which imports this through `vendor/sokuji`, sends the same events with
 * the same properties and the two compare in PostHog. Types and one pure
 * mapping: platform-neutral. No content, no keys, no reference ids.
 */
import type { DropCause, GiveUp } from './reconnect';

export type ReconnectClient = 'desktop' | 'extension' | 'ios' | 'android';
/** Mobile fills it from `expo-network`; desktop and the extension usually cannot tell and send `unknown`. */
export type NetworkType = 'wifi' | 'cellular' | 'ethernet' | 'unknown';

type Channel = 'speaker' | 'participant' | 'shared';

export interface ReconnectAnalyticsEvents {
  'connection_dropped': {
    session_id: string;
    provider: string;
    managed: boolean;
    channel: Channel;
    cause: DropCause;
    close_code?: number;
    error_code?: string;
    retryable: boolean;
    session_elapsed_ms: number;
    drop_index: number;
    since_last_reconnect_ms?: number;
    online?: boolean;
    client: ReconnectClient;
    network?: NetworkType;
  };
  'connection_reconnected': {
    session_id: string;
    provider: string;
    managed: boolean;
    channel: Channel;
    down_ms: number;
    attempts: number;
    credentials_reissued: boolean;
    reissue_ms: number;
    drop_index: number;
    budget_shared: boolean;
    client: ReconnectClient;
    network?: NetworkType;
  };
  'connection_reconnect_failed': {
    session_id: string;
    provider: string;
    managed: boolean;
    channel: Channel;
    down_ms: number;
    attempts: number;
    /** `stopped`: the user ended the session while it was reconnecting. */
    reason: GiveUp['reason'] | 'stopped';
    error_code?: string;
    refusal_code?: string;
    drop_index: number;
    client: ReconnectClient;
  };
}

/** The web build runs as the desktop client in a browser tab; only the extension and the mobile apps are told apart. */
export function reconnectClient(platform: 'electron' | 'extension' | 'web'): ReconnectClient {
  return platform === 'extension' ? 'extension' : 'desktop';
}
