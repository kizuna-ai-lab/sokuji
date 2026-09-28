/**
 * A virtual clock that counts its live timers — what an adapter's stop must
 * leave at zero. Soniox's and Gemini's suites each kept a copy; the third
 * adapter that needed one (Doubao AST 2.0) moved it here (Stage 2 Gemini,
 * choice 21). Test-only, like the rest of the kit.
 */
import { createVirtualClock, type VirtualClock } from '../clock';

export function trackedClock(): { clock: VirtualClock; timers: () => number } {
  const inner = createVirtualClock(0);
  const live = new Set<symbol>();
  const clock: VirtualClock = {
    now: () => inner.now(),
    advance: (ms) => inner.advance(ms),
    setTimeout(fn, ms) {
      const id = Symbol('timer');
      live.add(id);
      const cancel = inner.setTimeout(() => { live.delete(id); fn(); }, ms);
      return () => { live.delete(id); cancel(); };
    },
  };
  return { clock, timers: () => live.size };
}
