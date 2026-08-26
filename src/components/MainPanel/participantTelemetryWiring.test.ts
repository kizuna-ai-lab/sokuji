import { describe, it, expect, vi } from 'vitest';
import { buildChannelTelemetryHandlers } from './participantTelemetry';
import { settleReports } from '../../lib/diagnostics/report';
import useLogStore from '../../stores/logStore';
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
  // --- onDiagnostic: session continues, degraded ------------------------------
  //
  // Clients cannot know which leg they are on, so a failure that leaves the
  // session running (a frame that would not parse, a cleanup step that threw,
  // TTS falling back) is emitted as a code and given its channel here.

  it('routes a client diagnostic to the panel tagged with its channel', async () => {
    const w = makeWorld();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());

    participant.onDiagnostic({ code: 'parse_error', message: 'unexpected frame' });
    await settleReports();

    const entries = useLogStore.getState().allLogs;
    expect(entries).toHaveLength(1);
    expect(entries[0].clientId).toBe('participant');
    expect(entries[0].type).toBe('warning');
    expect(entries[0].message).toContain('parse_error: unexpected frame');
    warn.mockRestore();
  });

  it('takes the severity from the code table, not the call site', async () => {
    const w = makeWorld();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());

    speaker.onDiagnostic({ code: 'input_pipeline_failed', message: 'worklet gone' });
    await settleReports();

    expect(useLogStore.getState().allLogs[0].type).toBe('error');
    err.mockRestore();
  });

  it('does not raise a bubble or an api_error for a diagnostic', () => {
    const w = makeWorld();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());

    speaker.onDiagnostic({ code: 'cleanup_failed', message: 'socket already closed' });

    // onError is the "session is broken" path; a diagnostic must not borrow it.
    expect(w.apiErrors).toHaveLength(0);
    expect(w.logs).toHaveLength(0);
    warn.mockRestore();
  });

  it('collapses a burst of the same diagnostic code', async () => {
    const w = makeWorld();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());

    for (let i = 0; i < 5; i++) {
      speaker.onDiagnostic({ code: 'parse_error', message: `bad frame ${i}` });
    }
    await settleReports();

    expect(useLogStore.getState().allLogs).toHaveLength(1);
    // The console still saw every one.
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  // --- onConnectFailed: the session never started -----------------------------
  //
  // Session-start failures never reach onError: clients throw out of connect()
  // and MainPanel's own catch blocks handled them, with different row types,
  // no channel tag (so a participant failure filed under the speaker tab) and
  // analytics for the speaker only.

  it('tags the speaker connect failure and reports it to analytics', () => {
    const w = makeWorld();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());

    speaker.onConnectFailed(new Error('401 invalid api key'));

    expect(w.logs).toEqual([{ type: 'session.init_error', clientId: 'speaker' }]);
    expect(w.apiErrors).toHaveLength(1);
    expect(w.apiErrors[0]).toMatchObject({ error_message: '401 invalid api key' });
    err.mockRestore();
  });

  it('files the participant connect failure under the participant tab', () => {
    const w = makeWorld();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());

    participant.onConnectFailed(new Error('402 payment required'));

    // Previously this row carried no clientId at all, and logStore defaulted it
    // to 'speaker' — so a participant-leg failure was filed under "Me".
    expect(w.logs).toEqual([{ type: 'participant.error', clientId: 'participant' }]);
    // Previously the participant leg produced no analytics event whatsoever.
    expect(w.apiErrors).toHaveLength(1);
    err.mockRestore();
  });

  it('returns the readable message so the caller can raise the bubble', () => {
    const w = makeWorld();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());

    expect(speaker.onConnectFailed({ error: { message: 'quota exceeded' } }))
      .toBe('quota exceeded');
    err.mockRestore();
  });
});
