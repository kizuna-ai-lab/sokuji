import { describe, it, expect, expectTypeOf } from 'vitest';
import { reconnectClient, type ReconnectAnalyticsEvents } from './reconnectEvents';
import type { AnalyticsEvents } from '../analytics';
import { recordEvents } from '../contract/events';

describe('reconnectClient', () => {
  it('maps each platform to the client the events carry', () => {
    expect(reconnectClient('electron')).toBe('desktop');
    expect(reconnectClient('extension')).toBe('extension');
    expect(reconnectClient('web')).toBe('desktop');
  });
});

describe('the reconnect events in AnalyticsEvents', () => {
  it('are the shared definitions, not copies', () => {
    expectTypeOf<AnalyticsEvents['connection_dropped']>().toEqualTypeOf<ReconnectAnalyticsEvents['connection_dropped']>();
    expectTypeOf<AnalyticsEvents['connection_reconnected']>().toEqualTypeOf<ReconnectAnalyticsEvents['connection_reconnected']>();
    expectTypeOf<AnalyticsEvents['connection_reconnect_failed']>().toEqualTypeOf<ReconnectAnalyticsEvents['connection_reconnect_failed']>();
  });

  it('translation_session_end carries the optional reconnect totals', () => {
    expectTypeOf<AnalyticsEvents['translation_session_end']>().toMatchTypeOf<{ reconnect_count?: number; reconnect_down_ms?: number; reconnect_failed?: boolean }>();
  });
});

describe('the leg events carry reconnect payloads', () => {
  it('records the payload of reconnecting, and none for a payload-less call', () => {
    const { events, log } = recordEvents();
    events.reconnecting({ attempt: 2 });
    events.reconnecting();
    expect(log).toEqual([
      { kind: 'reconnecting', payload: { attempt: 2 } },
      { kind: 'reconnecting', payload: undefined },
    ]);
  });

  it('records reconnected and failed payloads', () => {
    const { events, log } = recordEvents();
    const info = { attempts: 1, credentialsReissued: true, reissueMs: 40, budgetShared: false };
    events.reconnected(info);
    events.failed({ message: 'x', code: 'connection_lost', giveUp: { attempts: 3, reason: 'timeout' } });
    expect(log).toEqual([
      { kind: 'reconnected', payload: info },
      { kind: 'failed', payload: { message: 'x', code: 'connection_lost', giveUp: { attempts: 3, reason: 'timeout' } } },
    ]);
  });
});
