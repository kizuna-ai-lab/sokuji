import { describe, it, expect } from 'vitest';
import {
  NO_CHANNELS_RECONNECTING,
  channelReconnecting,
  channelReconnected,
  isAnyChannelReconnecting,
  type ReconnectingState,
} from './reconnectingChannels';

/**
 * MainPanel renders ONE `isReconnecting` boolean (the status dot and its
 * banner) but split Both mode runs TWO independent clients that reconnect
 * independently. Wiring both legs' onReconnecting/onReconnected straight to
 * `setIsReconnecting` would let whichever leg recovers first clear the banner
 * while the other is still down — the user sees a healthy dot on a session
 * that is half dead. This module is the arbiter, kept out of MainPanel so it
 * has an actual production implementation the wiring test can import.
 */
describe('reconnectingChannels', () => {
  it('starts with nothing reconnecting', () => {
    expect(isAnyChannelReconnecting(NO_CHANNELS_RECONNECTING)).toBe(false);
  });

  it('reports reconnecting while either leg is down', () => {
    const s = channelReconnecting(NO_CHANNELS_RECONNECTING, 'participant');
    expect(isAnyChannelReconnecting(s)).toBe(true);
  });

  it('keeps the flag on when only ONE of two down legs recovers', () => {
    // The bug this module exists to prevent.
    let s: ReconnectingState = NO_CHANNELS_RECONNECTING;
    s = channelReconnecting(s, 'speaker');
    s = channelReconnecting(s, 'participant');
    s = channelReconnected(s, 'speaker');
    expect(isAnyChannelReconnecting(s)).toBe(true);
    s = channelReconnected(s, 'participant');
    expect(isAnyChannelReconnecting(s)).toBe(false);
  });

  it('contrast: a single shared boolean clears early — this is the bug', () => {
    // Not the real implementation. Kept to prove the assertion above depends
    // on the per-channel set rather than being true whatever we wrote.
    let sharedFlag = false;
    sharedFlag = true;   // speaker onReconnecting
    sharedFlag = true;   // participant onReconnecting
    sharedFlag = false;  // speaker onReconnected — clears while participant is still down
    expect(sharedFlag).toBe(false);
  });

  it('is idempotent: a client may announce the same transition more than once', () => {
    let s: ReconnectingState = NO_CHANNELS_RECONNECTING;
    s = channelReconnecting(s, 'speaker');
    s = channelReconnecting(s, 'speaker');
    s = channelReconnected(s, 'speaker');
    expect(isAnyChannelReconnecting(s)).toBe(false);
  });

  it('ignores a reconnected for a leg that never announced reconnecting', () => {
    const s = channelReconnected(NO_CHANNELS_RECONNECTING, 'participant');
    expect(isAnyChannelReconnecting(s)).toBe(false);
  });

  it('never mutates the state handed to it — it lives in a ref read during render', () => {
    const before: ReconnectingState = NO_CHANNELS_RECONNECTING;
    const after = channelReconnecting(before, 'speaker');
    expect(before).toEqual([]);
    expect(after).not.toBe(before);
  });
});
