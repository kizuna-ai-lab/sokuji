// src/viewer/keepAwake.ts
/**
 * Keeping the screen on (spec 2026-10-04 §5.6). The page is plain HTTP, so
 * the Wake Lock API is unavailable; nosleep.js then plays a tiny muted,
 * looping inline video. `enable()` must run inside a tap.
 */
import NoSleep from 'nosleep.js';

let instance: NoSleep | null = null;

export async function keepAwake(on: boolean): Promise<boolean> {
  try {
    instance ??= new NoSleep();
    if (on) await instance.enable();
    else instance.disable();
    return true;
  } catch {
    return false;
  }
}
