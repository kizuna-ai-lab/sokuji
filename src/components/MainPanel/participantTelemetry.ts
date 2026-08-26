import type { AnalyticsEvents } from '../../lib/analytics';
import type { ClientId, EventData, RealtimeEventSource } from '../../stores/logStore';
import { buildApiErrorProps, clientErrorMessage, type ClientErrorEvent } from '../../lib/apiErrorProps';
import { reportError, reportWarning, describeCause } from '../../lib/diagnostics/report';
import {
  CLIENT_DIAGNOSTICS,
  type ClientDiagnostic,
} from '../../lib/diagnostics/clientDiagnostics';
import {
  channelReconnecting,
  channelReconnected,
  isAnyChannelReconnecting,
  type ReconnectingState,
} from './reconnectingChannels';

/**
 * The half of MainPanel's client event wiring that BOTH legs need.
 *
 * Until this existed, `setupClientListeners` hardcoded
 * `speakerClientRef.current`, so onError / onReconnecting / onReconnected could
 * only ever reach the speaker, while `createParticipantEventHandlers` wired
 * three handlers and no telemetry at all. In split Both mode the participant is
 * an independently failing provider stream, so that asymmetry hid roughly half
 * of all split-session outages from the error dashboards.
 *
 * Extracted from MainPanel (which has no test harness) so the wiring is a real
 * function a test can call — the same discipline `resolveVoicePrepOutcome`
 * follows.
 */
export interface ChannelTelemetryPorts {
  addRealtimeEvent: (
    event: EventData,
    source: RealtimeEventSource,
    eventType: string,
    clientId: ClientId
  ) => void;
  trackApiError: (props: AnalyticsEvents['api_error']) => void;
  /** Already defaulted by the caller — MainPanel passes `provider || Provider.OPENAI`. */
  provider: string;
  /** Reads/writes MainPanel's ref. Not React state: these fire from socket
   *  callbacks that can land several times inside one frame, and each one needs
   *  the value the previous one wrote. */
  readReconnecting: () => ReconnectingState;
  writeReconnecting: (next: ReconnectingState) => void;
  /** The single rendered boolean, derived from the whole set. */
  setIsReconnecting: (value: boolean) => void;
}

export interface ChannelTelemetryHandlers {
  onError: (event: ClientErrorEvent) => void;
  /** Session continues, degraded. No bubble, no api_error — one panel entry. */
  onDiagnostic: (diagnostic: ClientDiagnostic) => void;
  /**
   * The session never started: the client threw out of `connect()`.
   *
   * @returns the readable message, so the caller can raise its bubble from the
   *   same string this filed.
   */
  onConnectFailed: (error: unknown) => string;
  onReconnecting: () => void;
  onReconnected: () => void;
}

export function buildChannelTelemetryHandlers(
  channel: ClientId,
  ports: ChannelTelemetryPorts
): ChannelTelemetryHandlers {
  const apply = (next: ReconnectingState) => {
    ports.writeReconnecting(next);
    // Derived, never assigned directly: one leg recovering must not clear the
    // banner while the other is still down. See reconnectingChannels.ts.
    ports.setIsReconnecting(isAnyChannelReconnecting(next));
  };

  return {
    onError: (event: ClientErrorEvent) => {
      const message = clientErrorMessage(event);
      console.error(`[Sokuji] [MainPanel] [${channel}]`, event);
      ports.addRealtimeEvent(
        { type: 'session.error', data: { message, event } },
        'client',
        'session.error',
        channel
      );
      // buildApiErrorProps, not an inline object: which string becomes
      // error_message decides whether outages group at all, and `message`
      // above is the possibly-localized one the UI renders.
      ports.trackApiError(buildApiErrorProps(event, ports.provider, channel));
    },

    onDiagnostic: (diagnostic: ClientDiagnostic) => {
      const { severity } = CLIENT_DIAGNOSTICS[diagnostic.code];
      const report = severity === 'error' ? reportError : reportWarning;
      // dedupeKey is the code, not the message: a burst of parse failures
      // varies its text per frame but is one condition, and this runs on the
      // socket callback path.
      report(`Client:${ports.provider}`, `${diagnostic.code}: ${diagnostic.message}`, {
        cause: diagnostic.cause,
        clientId: channel,
        dedupeKey: diagnostic.code,
      });
    },

    onConnectFailed: (error: unknown) => {
      const message = describeCause(error);
      // Both legs, one shape. MainPanel used to handle these in two separate
      // catch blocks: the speaker emitted `session.init_error` plus an
      // `error_occurred` event, while the participant emitted
      // `participant.error` with NO channel tag — so logStore's old default
      // filed it under the speaker tab — and no analytics at all.
      console.error(`[Sokuji] [MainPanel] [${channel}] connect failed:`, error);
      ports.addRealtimeEvent(
        {
          type: channel === 'speaker' ? 'session.init_error' : 'participant.error',
          data: { message },
        },
        'client',
        channel === 'speaker' ? 'session.init_error' : 'participant.error',
        channel
      );
      ports.trackApiError(buildApiErrorProps({ message }, ports.provider, channel));
      return message;
    },

    onReconnecting: () => {
      console.info(`[Sokuji] [MainPanel] [${channel}] session reconnecting...`);
      apply(channelReconnecting(ports.readReconnecting(), channel));
      ports.addRealtimeEvent(
        { type: 'session.reconnecting', data: { timestamp: Date.now() } },
        'client',
        'session.reconnecting',
        channel
      );
    },

    onReconnected: () => {
      console.info(`[Sokuji] [MainPanel] [${channel}] session reconnected successfully`);
      apply(channelReconnected(ports.readReconnecting(), channel));
      ports.addRealtimeEvent(
        { type: 'session.reconnected', data: { timestamp: Date.now() } },
        'client',
        'session.reconnected',
        channel
      );
    },
  };
}
