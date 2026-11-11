import useLogStore from '../stores/logStore';
import { reportWarning } from '../lib/diagnostics/report';
import { NETWORK_STAGE_PATHS, type NetworkStage } from '../lib/diagnostics/sessionNetwork';

/** Only a stage this build knows names a path; the payload's own `path` is
 * never read. Main's table is its own copy of the same allowlist. */
const isStage = (value: unknown): value is NetworkStage =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(NETWORK_STAGE_PATHS, value);

/** Main sends only allowlisted transport facts; the usual event sink owns
 * display, redaction and Copy logs. Subscribe to the store's actual switch,
 * including settings load and a failed setting write's rollback. */
export function attachNetworkDiagnostics(electron = window.electron): () => void {
  if (!electron) return () => {};
  const receive = (value: unknown) => {
    if (!useLogStore.getState().enabled || !value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (!isStage(data.stage)) return;
    if (data.phase !== 'started' && data.phase !== 'completed' && data.phase !== 'error') return;
    if (!Number.isSafeInteger(data.requestId) || !Number.isSafeInteger(data.timestamp)
      || !Number.isSafeInteger(data.durationMs) || (data.durationMs as number) < 0) return;
    // Reconstruct the allowlist at the IPC boundary too. Never give the log
    // sink an arbitrary object, URL, header or error message to retain/export.
    const facts = {
      requestId: data.requestId, stage: data.stage, phase: data.phase,
      path: NETWORK_STAGE_PATHS[data.stage],
      timestamp: data.timestamp, durationMs: data.durationMs,
      ...(Number.isInteger(data.status) && (data.status as number) >= 100 && (data.status as number) <= 599 ? { status: data.status } : {}),
      ...(typeof data.cfRay === 'string' && /^[a-f0-9]{16,32}-[a-z]{3}$/i.test(data.cfRay) ? { cfRay: data.cfRay } : {}),
      ...(typeof data.chromiumError === 'string' && /^net::ERR_[A-Z0-9_]{1,80}$/.test(data.chromiumError) ? { chromiumError: data.chromiumError } : {}),
    };
    const type = data.phase === 'error' ? 'session.network.error' : 'session.network.transport';
    useLogStore.getState().addRealtimeEvent({ type, data: facts }, 'client', type);
  };
  const sync = (enabled: boolean) => {
    void electron.invoke('session-network:set-enabled', enabled).catch((cause: unknown) => {
      if (enabled) reportWarning('NetworkDiagnostics', 'Could not enable session-service network diagnostics.', { cause, dedupeKey: 'network-diagnostics.enable' });
    });
  };
  electron.receive('session-network:event', receive);
  const unsubscribe = useLogStore.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled) sync(state.enabled);
  });
  sync(useLogStore.getState().enabled);
  return () => {
    unsubscribe();
    electron.removeListener('session-network:event', receive);
    sync(false);
  };
}
