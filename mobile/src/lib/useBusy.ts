import { useState } from 'react';
import { createBusyGuard } from './busy';

/** `[busy, run]`: `run(action)` does nothing while the last action is still running. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [guard] = useState(() => createBusyGuard(setBusy));
  return [busy, guard.run] as const;
}
