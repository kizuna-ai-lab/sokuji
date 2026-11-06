/**
 * The system's own list of output devices (spec 2026-11-05 §6), read from the
 * main process only on events, never on a timer: the helper behind it is a
 * process spawned per read. The answer counts only while no event has come
 * since the read that produced it began; stale is no answer, never the last one.
 */
import { describeCause, reportWarning } from '../diagnostics/report';
import type { FormFactor, NativeOutputsResult, OutputDeviceInfo, Transport } from './formFactor';

/** What asked for a read: first use, the browser's `devicechange`, a push from main, the page shown again. */
export type NativeReadReason = 'first' | 'devicechange' | 'push' | 'visible';

/** After a failed read; once the last of these fails too, nothing is read until the next event. */
export const RETRY_DELAYS_MS = [1000, 5000, 30000];

const FAILED: NativeOutputsResult = { ok: false, reason: 'read failed' };

export interface NativeOutputReader {
  request(reason: NativeReadReason): void;
  current(): readonly OutputDeviceInfo[] | null;
  dispose(): void;
}

export function createNativeOutputReader(deps: {
  read: () => Promise<NativeOutputsResult>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  onUpdate: () => void;
}): NativeOutputReader {
  // Events are ordered by count, not by clock: an event in the same
  // millisecond a read began still comes after it.
  let events = 0;
  /** The answer, only while it is current. */
  let devices: readonly OutputDeviceInfo[] | null = null;
  let reading = false;
  let failures = 0;
  let retry: { handle: unknown } | null = null;
  let disposed = false;

  const answer = (next: readonly OutputDeviceInfo[] | null) => {
    if (next === devices) return;
    devices = next;
    deps.onUpdate();
  };

  const cancelRetry = () => {
    if (retry) deps.clearTimeout(retry.handle);
    retry = null;
  };

  const read = () => {
    reading = true;
    const startedAfter = events;
    let pending: Promise<NativeOutputsResult>;
    try {
      pending = deps.read().catch(() => FAILED);
    } catch {
      pending = Promise.resolve(FAILED);
    }
    void pending.then((result) => {
      if (disposed) return;
      reading = false;
      // An event came while this read ran: its answer may predate the event.
      if (events !== startedAfter) {
        read();
        return;
      }
      if (result.ok) {
        failures = 0;
        answer(result.devices);
        return;
      }
      if (failures < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[failures];
        failures += 1;
        retry = {
          handle: deps.setTimeout(() => {
            retry = null;
            read();
          }, delay),
        };
      }
    });
  };

  return {
    request() {
      if (disposed) return;
      events += 1;
      cancelRetry();
      // A new event gets the whole retry schedule.
      failures = 0;
      answer(null);
      if (!reading) read();
    },
    current: () => devices,
    dispose() {
      disposed = true;
      cancelRetry();
    },
  };
}

// Records, so the compiler insists every member of each type is listed.
const FORM_FACTORS: Record<FormFactor, true> = { headphones: true, speakers: true, unknown: true };
const TRANSPORTS: Record<Transport, true> = { builtin: true, usb: true, bluetooth: true, hdmi: true, virtual: true, unknown: true };
const isMember = (set: object, value: unknown) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(set, value);

/** Every entry as the matcher reads it: one without a string label would throw inside the device listing. */
function wellFormed(devices: unknown[]): devices is OutputDeviceInfo[] {
  return devices.every((d) => {
    if (typeof d !== 'object' || d === null) return false;
    const { label, isDefault, formFactor, transport } = d as Record<string, unknown>;
    return typeof label === 'string' && typeof isDefault === 'boolean' && isMember(FORM_FACTORS, formFactor) && isMember(TRANSPORTS, transport);
  });
}

/** The preload's bridge, as much of it as the reader uses. */
type NativeIpc = Pick<ElectronAPI, 'invoke' | 'receive'> & Partial<Pick<ElectronAPI, 'removeListener'>>;

let started: NativeOutputReader | null = null;

/**
 * Reads now and on every later event: a push from main (a sink change on
 * Linux, a wake from sleep) and the page becoming visible. `devicechange`
 * arrives through `requestForSync`, from the device watch that already
 * listens for it. Electron only: the caller checks, since the extension
 * shares this code but has no main process to ask.
 *
 * `onUpdate` runs, synchronously, whenever what `currentNativeOutputs()` gives
 * changes: an answer arriving, going stale on an event, or taken away by dispose.
 */
export function startNativeOutputs(
  onUpdate: () => void,
  deps: { ipc?: NativeIpc; doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> } = {},
): { request(reason: NativeReadReason): void; dispose(): void } {
  const ipc = deps.ipc ?? window.electron;
  const doc = deps.doc ?? document;

  const read = async (): Promise<NativeOutputsResult> => {
    let reason: string;
    let cause: unknown;
    try {
      const answer = await ipc.invoke('get-output-devices');
      if (answer?.ok === true && Array.isArray(answer.devices) && wellFormed(answer.devices)) return answer;
      reason = answer?.ok === false && typeof answer.reason === 'string' ? answer.reason : 'malformed answer';
      cause = answer;
    } catch (error) {
      reason = describeCause(error);
      cause = error;
    }
    // Deduped: a helper that cannot start fails the first read and each of its retries.
    reportWarning('NativeOutputs', `Reading the output devices failed (${reason}); every output reads unknown until a read succeeds`, { cause, dedupeKey: 'native-outputs:read' });
    return { ok: false, reason };
  };

  const reader = createNativeOutputReader({
    read,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onUpdate,
  });
  const onPush = () => reader.request('push');
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') reader.request('visible');
  };

  ipc.receive('output-devices:changed', onPush);
  doc.addEventListener('visibilitychange', onVisibility);
  started = reader;
  reader.request('first');

  let disposed = false;
  return {
    request: (reason) => reader.request(reason),
    dispose() {
      if (disposed) return;
      disposed = true;
      const tookAnswer = started === reader && reader.current() !== null;
      ipc.removeListener?.('output-devices:changed', onPush);
      doc.removeEventListener('visibilitychange', onVisibility);
      reader.dispose();
      if (started === reader) started = null;
      // With no reader there is no current answer: stale, like after any event.
      if (tookAnswer) onUpdate();
    },
  };
}

/** The device watch's sync, passed on: `devicechange` reads again, the 3-second poll never does. */
export function requestForSync(native: { request(r: NativeReadReason): void } | null, reason: 'change' | 'poll'): void {
  if (reason === 'change') native?.request('devicechange');
}

/** What the started reader holds: `null` while stale, and with none started (the extension, tests). */
export function currentNativeOutputs(): readonly OutputDeviceInfo[] | null {
  return started ? started.current() : null;
}
