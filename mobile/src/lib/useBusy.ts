import { useRef, useState } from 'react';
import { createBusyGuard } from './busy';

/** `[busy, run]`: `run(action)` does nothing while the last action is still running. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const guard = useRef<ReturnType<typeof createBusyGuard> | null>(null);
  guard.current ??= createBusyGuard(setBusy);
  return [busy, guard.current.run] as const;
}
