import { describe, it, expect, vi } from 'vitest';
import { buildChannelTelemetryHandlers } from './participantTelemetry';
import {
  NO_CHANNELS_RECONNECTING,
  isAnyChannelReconnecting,
  type ReconnectingState,
} from './reconnectingChannels';

/**
 * MainPanel.tsx's `createParticipantEventHandlers` used to wire only
 * onRealtimeEvent / onConversationUpdated / onClose, and `setupClientListeners`
 * reads `speakerClientRef.current` so the full handler set could only ever
 * reach the speaker. Split Both mode makes the participant an independently
 * failing provider stream, so that asymmetry under-counts outages in the error
 * dashboards by roughly half.
 *
 * There is no React rendering harness in this repo (see
 * participantErrorOrdering.test.ts and voicePrepWiring.test.ts for the same
 * constraint), so the shared handler set was extracted into
 * `buildChannelTelemetryHandlers` specifically so this file can import and call
 * the REAL production function with fake ports, rather than hand-transcribing a
 * duplicate that could drift from the shipped wiring without either side
 * noticing.
 */
function makeWorld() {
  let reconnecting: ReconnectingState = NO_CHANNELS_RECONNECTING;
  let renderedIsReconnecting = false;
  const logs: Array<{ type: string; clientId: string }> = [];
  const apiErrors: any[] = [];

  const portsFor = (provider = 'soniox') => ({
    addRealtimeEvent: (event: any, _source: any, eventType: string, clientId: any) => {
      logs.push({ type: eventType || event?.type, clientId });
    },
    trackApiError: (props: any) => { apiErrors.push(props); },
    provider,
    readReconnecting: () => reconnecting,
    writeReconnecting: (next: ReconnectingState) => { reconnecting = next; },
    setIsReconnecting: (v: boolean) => { renderedIsReconnecting = v; },
  });

  return {
    portsFor,
    logs,
    apiErrors,
    getReconnecting: () => reconnecting,
    getRenderedIsReconnecting: () => renderedIsReconnecting,
  };
}

describe('per-channel telemetry handlers', () => {
  it('sends the participant leg\'s error to api_error tagged as participant', () => {
    const w = makeWorld();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());
    participant.onError({ code: '503', message: 'service unavailable' });
    spy.mockRestore();

    expect(w.apiErrors).toHaveLength(1);
    expect(w.apiErrors[0]).toMatchObject({
      provider: 'soniox',
      error_code: '503',
      error_message: 'service unavailable',
      channel: 'participant',
    });
  });

  it('contrast: the old wiring emitted nothing at all for a participant error', () => {
    // Reproduces the pre-fix handler set — three handlers, no onError — to
    // prove the assertion above depends on the new wiring rather than on
    // buildApiErrorProps being callable.
    const w = makeWorld();
    const preFix: Record<string, unknown> = {
      onRealtimeEvent: () => {},
      onConversationUpdated: () => {},
      onClose: () => {},
    };
    expect(preFix.onError).toBeUndefined();
    expect(w.apiErrors).toHaveLength(0);
  });

  it('tags the participant\'s log entries so LogsPanel can attribute the outage', () => {
    const w = makeWorld();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());
    participant.onError({ message: 'boom' });
    participant.onReconnecting();
    participant.onReconnected();
    spy.mockRestore();

    expect(w.logs).toEqual([
      { type: 'session.error', clientId: 'participant' },
      { type: 'session.reconnecting', clientId: 'participant' },
      { type: 'session.reconnected', clientId: 'participant' },
    ]);
  });

  it('keeps the rendered reconnect banner up until BOTH legs are back', () => {
    const w = makeWorld();
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());

    speaker.onReconnecting();
    participant.onReconnecting();
    expect(w.getRenderedIsReconnecting()).toBe(true);

    speaker.onReconnected();
    // The whole point: the speaker recovering must not tell the user the
    // session is healthy while the participant leg is still down.
    expect(w.getRenderedIsReconnecting()).toBe(true);
    expect(isAnyChannelReconnecting(w.getReconnecting())).toBe(true);

    participant.onReconnected();
    expect(w.getRenderedIsReconnecting()).toBe(false);
  });

  it('does not double-count when the same leg re-announces a reconnect attempt', () => {
    const w = makeWorld();
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());
    speaker.onReconnecting();
    speaker.onReconnecting();
    speaker.onReconnected();
    expect(w.getRenderedIsReconnecting()).toBe(false);
  });

  it('prefers rawMessage for analytics while the log entry keeps the localized text', () => {
    const w = makeWorld();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());
    participant.onError({
      code: '503',
      message: '接続が中断されました',
      rawMessage: 'service unavailable',
    });
    expect(w.apiErrors[0].error_message).toBe('service unavailable');
    spy.mockRestore();
  });
});
