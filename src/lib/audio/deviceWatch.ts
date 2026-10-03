/**
 * Follows the OS's audio devices (spec 2026-10-04 §1): `devicechange`,
 * debounced — a Bluetooth connect fires a burst — and one sync at a time, a
 * change during a sync queuing exactly one more. And, while `shouldPoll` holds,
 * a poll every `pollMs`: Chromium on Linux announces only udev sound cards, so a
 * Bluetooth or PipeWire device coming back is seen only when the devices are
 * listed again.
 */
import { describeCause, reportWarning } from '../diagnostics/report';

export interface DeviceWatchOptions {
  sync(): Promise<unknown>;
  mediaDevices?: Pick<MediaDevices, 'addEventListener' | 'removeEventListener'>;
  delayMs?: number;
  /** Checked every `pollMs`; while true, the sync also runs on that beat (one flight with `devicechange`'s). */
  shouldPoll?(): boolean;
  pollMs?: number;
}

export function watchDevices({ sync, mediaDevices = globalThis.navigator?.mediaDevices, delayMs = 500, shouldPoll, pollMs = 3000 }: DeviceWatchOptions): () => void {
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

  const poll = shouldPoll
    ? setInterval(() => {
        if (shouldPoll()) void run();
      }, pollMs)
    : null;

  mediaDevices.addEventListener('devicechange', onChange);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    if (poll !== null) clearInterval(poll);
    mediaDevices.removeEventListener('devicechange', onChange);
  };
}
