/**
 * Follows the OS's audio devices (spec 2026-10-04 §1): `devicechange`,
 * debounced — a Bluetooth connect fires a burst — and one sync at a time, a
 * change during a sync queuing exactly one more.
 */
import { describeCause, reportWarning } from '../diagnostics/report';

export interface DeviceWatchOptions {
  sync(): Promise<unknown>;
  mediaDevices?: Pick<MediaDevices, 'addEventListener' | 'removeEventListener'>;
  delayMs?: number;
}

export function watchDevices({ sync, mediaDevices = globalThis.navigator?.mediaDevices, delayMs = 500 }: DeviceWatchOptions): () => void {
  if (!mediaDevices?.addEventListener) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let stopped = false;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await sync();
        } catch (error) {
          reportWarning('DeviceWatch', `Following the audio devices failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'devices:sync' });
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };

  const onChange = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  };

  mediaDevices.addEventListener('devicechange', onChange);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    mediaDevices.removeEventListener('devicechange', onChange);
  };
}
